import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FAILED_PAGE } from "@/app/words.ts";
import { AUTHENTICATOR_WORDS } from "@/features/auth/account-words.ts";
import {
  CONFIRM_WORDS,
  RECOVERY_WORDS,
  SETUP_WORDS,
  USE_CODE,
} from "@/features/auth/second-factor/second-factor-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { SIGN_OUT } from "@/shared/words.ts";
import {
  A_CHALLENGE,
  adasApi,
  alertTexts,
  answering,
  BOTH_HELD,
  openAsAda,
  stubTrpcNeverAnswers,
  refusing,
  sessionStanding,
  withPasskeysHere,
} from "@test/second-factor-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

const main = () => screen.getByRole("main");

const numbersSaid = (): readonly string[] => alertTexts().join(" ").match(/\d+/g) ?? [];

const ONE_ALERT_WITH_WORDS = [expect.stringMatching(/\S/u)];

const controls = (): readonly Element[] => [...main().querySelectorAll("a, button, input")];

const CONFIRMED = { ...BOTH_HELD, thisSession: sessionStanding("confirmed", { confirmed: true }) };

const GRANTED = { ...BOTH_HELD, thisSession: sessionStanding("setup", { setupGranted: true }) };

const confirmingByPasskey = (refusedCode: () => Promise<Response>) => {
  let confirmed = false;
  const asked = adasApi(
    () => (confirmed ? CONFIRMED : BOTH_HELD),
    new Map([
      ["/second-factor/confirm/authenticator", refusedCode],
      ["/second-factor/confirm/passkey-options", answering(A_CHALLENGE)],
      [
        "/second-factor/confirm/passkey",
        () => {
          confirmed = true;
          return answering({ confirmed: true })();
        },
      ],
    ]),
  );
  return asked;
};

const grantingByRecoveryCode = () => {
  let granted = false;
  adasApi(
    () => (granted ? GRANTED : BOTH_HELD),
    new Map([
      [
        "/second-factor/recovery",
        () => {
          granted = true;
          return answering({ granted: true })();
        },
      ],
    ]),
  );
};

describe("the confirm page", () => {
  it("shows only the heading and Sign Out while loading", async () => {
    stubTrpcNeverAnswers();

    await openAsAda("/confirm");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(CONFIRM_WORDS.heading);
    expect(controls().map((control) => control.textContent)).toEqual([SIGN_OUT]);
  });

  it("focuses the passkey, then lists code, recovery code, Sign Out", async () => {
    withPasskeysHere();
    adasApi(() => BOTH_HELD);

    await openAsAda("/confirm");

    const passkey = await screen.findByRole("button", { name: CONFIRM_WORDS.passkey });
    const ways: readonly Element[] = [
      passkey,
      screen.getByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField }),
      screen.getByRole("link", { name: CONFIRM_WORDS.recoveryCode }),
      screen.getByRole("button", { name: SIGN_OUT }),
    ];
    expect(document.activeElement).toBe(passkey);
    expect(controls().filter((control) => ways.includes(control))).toEqual(ways);
    expect(controls().at(-1)).toBe(ways[3]);
  });

  it("after too many codes, the passkey still confirms", async () => {
    withPasskeysHere();
    const asked = confirmingByPasskey(refusing(429, "too_many_requests", 240));
    const { router } = await openAsAda("/confirm");

    const field = await screen.findByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });
    fireEvent.change(field, { target: { value: "123 456" } });

    await waitFor(() => {
      expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    });
    expect(numbersSaid()).toEqual(["4"]);
    expect(field.hasAttribute("readonly")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: CONFIRM_WORDS.passkey }));

    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe("/confirm");
    });
    expect(asked).toContain("/second-factor/confirm/passkey");
    expect(asked).not.toContain("/passkeys/sign-in");
  });

  it("unlocks the code field once the wait ends", async () => {
    adasApi(() => ({
      ...BOTH_HELD,
      passkeys: [],
      waits: { ...BOTH_HELD.waits, authenticator: 1 },
    }));
    await openAsAda("/confirm");

    const field = await screen.findByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });
    expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    expect(numbersSaid()).toEqual(["1"]);
    expect(field.hasAttribute("readonly")).toBe(true);

    await waitFor(
      () => {
        expect(field.hasAttribute("readonly")).toBe(false);
      },
      { timeout: 3000 },
    );
    expect(
      screen.getAllByRole("status").some((status) => /\S/u.test(status.textContent)),
      "no status says the field is open again",
    ).toBe(true);
    expect(alertTexts()).toEqual([]);
  });

  it("offers Try Again when loading gets no response", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));

    await openAsAda("/confirm");

    await waitFor(() => {
      expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    });
    expect(screen.getByRole("button", { name: FAILED_PAGE.retry })).toBeDefined();
    expect(screen.getByRole("button", { name: KEYSTROKE_WORDS.button })).toBeDefined();
  });

  it("keeps a wrong code's digits selected and marks it invalid", async () => {
    adasApi(
      () => BOTH_HELD,
      new Map([["/second-factor/confirm/authenticator", refusing(400, "code-wrong")]]),
    );
    await openAsAda("/confirm");

    const field = await screen.findByRole<HTMLInputElement>("textbox", {
      name: AUTHENTICATOR_WORDS.codeField,
    });
    fireEvent.change(field, { target: { value: "123456" } });

    await waitFor(() => {
      expect(field.getAttribute("aria-invalid")).toBe("true");
    });
    expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 6]);
  });

  it("skips the page for a session already confirmed", async () => {
    adasApi(() => CONFIRMED);

    const { router } = await openAsAda("/confirm");

    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe("/confirm");
    });
  });
});

describe("the recovery page", () => {
  it("goes to setup, keeping the redirect, once the code works", async () => {
    grantingByRecoveryCode();
    const { router } = await openAsAda("/recovery?redirect=%2Fpeople%2Fmembers");

    const field = await screen.findByRole("textbox", { name: RECOVERY_WORDS.field });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "ABCD efgh-jkmn-pqrs" } });
    fireEvent.click(screen.getByRole("button", { name: USE_CODE }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup");
    });
    expect(router.state.location.search).toEqual({ redirect: "/people/members" });
    expect(
      await screen.findByRole("heading", { level: 1, name: SETUP_WORDS.newHeading }),
    ).toBeDefined();
  });

  it("marks a wrong recovery code and offers the other methods", async () => {
    adasApi(
      () => BOTH_HELD,
      new Map([["/second-factor/recovery", refusing(400, "recovery-code-wrong")]]),
    );
    await openAsAda("/recovery");

    const field = await screen.findByRole("textbox", { name: RECOVERY_WORDS.field });
    fireEvent.change(field, { target: { value: "abcd-efgh-jkmn-pqrs" } });
    fireEvent.click(screen.getByRole("button", { name: USE_CODE }));

    await waitFor(() => {
      expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(within(main()).getByRole("link", { name: RECOVERY_WORDS.instead })).toBeDefined();
  });
});
