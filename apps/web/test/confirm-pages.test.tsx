import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTHENTICATOR_CODE_WRONG,
  SAID_OF_SECOND_FACTOR,
  tooManyCodesTriedOr,
} from "@/features/auth/refusal-words.ts";
import { CODE_AGAIN, RECOVERY_WORDS } from "@/features/auth/second-factor-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { STOCK } from "@/shared/refusal-words.ts";

import {
  A_CHALLENGE,
  adasApi,
  alertsSaying,
  answering,
  BOTH_HELD,
  openAsAda,
  readingForever,
  refusing,
  sessionStanding,
  withPasskeysHere,
} from "./second-factor-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

const main = () => screen.getByRole("main");

/** Each number the alerts name, which for a wait is its whole minutes. */
const numbersSaid = (): readonly string[] => alertsSaying().join(" ").match(/\d+/g) ?? [];

/** Every control a keyboard meets on the page, in document order. */
const controls = (): readonly Element[] => [...main().querySelectorAll("a, button, input")];

const CONFIRMED = { ...BOTH_HELD, thisSession: sessionStanding("confirmed", { confirmed: true }) };

const GRANTED = { ...BOTH_HELD, thisSession: sessionStanding("setup", { setupGranted: true }) };

/** The api confirms by passkey, and after it each read says the session is confirmed. */
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

describe("the confirm page", () => {
  it("shows only its heading and Sign out while reading", async () => {
    readingForever();

    await openAsAda("/confirm");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Confirm It’s You");
    expect(controls().map((control) => control.textContent)).toEqual(["Sign Out"]);
  });

  it("orders passkey (focused), code, recovery code, then Sign out", async () => {
    withPasskeysHere();
    adasApi(() => BOTH_HELD);

    await openAsAda("/confirm");

    const passkey = await screen.findByRole("button", { name: "Use Your Passkey" });
    const ways: readonly Element[] = [
      passkey,
      screen.getByRole("textbox", { name: "Authenticator Code" }),
      screen.getByRole("link", { name: "Use a Recovery Code" }),
      screen.getByRole("button", { name: "Sign Out" }),
    ];
    expect(document.activeElement).toBe(passkey);
    expect(controls().filter((control) => ways.includes(control))).toEqual(ways);
    expect(controls().at(-1)).toBe(ways[3]);
  });

  it("names the wait once throttled, and the passkey still confirms", async () => {
    withPasskeysHere();
    const asked = confirmingByPasskey(refusing(429, "too_many_requests", 240));
    const { router } = await openAsAda("/confirm");

    const field = await screen.findByRole("textbox", { name: "Authenticator Code" });
    fireEvent.change(field, { target: { value: "123 456" } });

    await waitFor(() => {
      expect(alertsSaying()).toEqual([tooManyCodesTriedOr(240, ["passkey", "recovery-code"])]);
    });
    expect(numbersSaid()).toEqual(["4"]);
    expect(field.hasAttribute("readonly")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Use Your Passkey" }));

    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe("/confirm");
    });
    expect(asked).toContain("/second-factor/confirm/passkey");
    expect(asked).not.toContain("/passkeys/sign-in");
  });

  it("names only ways held, then reopens once the wait lifts", async () => {
    adasApi(() => ({
      ...BOTH_HELD,
      passkeys: [],
      waits: { ...BOTH_HELD.waits, authenticator: 1 },
    }));
    await openAsAda("/confirm");

    const field = await screen.findByRole("textbox", { name: "Authenticator Code" });
    expect(alertsSaying()).toEqual([tooManyCodesTriedOr(1, ["recovery-code"])]);
    expect(numbersSaid()).toEqual(["1"]);
    expect(field.hasAttribute("readonly")).toBe(true);

    expect(await screen.findByText(CODE_AGAIN, {}, { timeout: 3000 })).toBeDefined();
    expect(field.hasAttribute("readonly")).toBe(false);
    expect(alertsSaying()).toEqual([]);
  });

  it("offers Try again when the read goes unanswered", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));

    await openAsAda("/confirm");

    await waitFor(() => {
      expect(alertsSaying()).toEqual([STOCK.notLoaded]);
    });
    expect(screen.getByRole("button", { name: "Try Again" })).toBeDefined();
    expect(screen.getByRole("button", { name: KEYSTROKE_WORDS.button })).toBeDefined();
  });

  it("keeps a wrong code's digits selected and marks it invalid", async () => {
    adasApi(
      () => BOTH_HELD,
      new Map([["/second-factor/confirm/authenticator", refusing(400, "code-wrong")]]),
    );
    await openAsAda("/confirm");

    const field = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "Authenticator Code",
    });
    fireEvent.change(field, { target: { value: "123456" } });

    await waitFor(() => {
      expect(field.getAttribute("aria-invalid")).toBe("true");
    });
    expect(alertsSaying()).toEqual([AUTHENTICATOR_CODE_WRONG]);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 6]);
  });

  it("goes straight on for a session already confirmed", async () => {
    adasApi(() => CONFIRMED);

    const { router } = await openAsAda("/confirm");

    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe("/confirm");
    });
  });
});

describe("the recovery page", () => {
  it("goes to setup with the page's query once accepted", async () => {
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
    const { router } = await openAsAda("/recovery?redirect=%2Fpeople%2Fmembers");

    const field = await screen.findByRole("textbox", { name: "Recovery Code" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "ABCD efgh-jkmn-pqrs" } });
    fireEvent.click(screen.getByRole("button", { name: "Use Code" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup");
    });
    expect(router.state.location.search).toEqual({ redirect: "/people/members" });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Set Up a New Second Factor" }),
    ).toBeDefined();
  });

  it("says a wrong code, and offers the way back last", async () => {
    adasApi(
      () => BOTH_HELD,
      new Map([["/second-factor/recovery", refusing(400, "recovery-code-wrong")]]),
    );
    await openAsAda("/recovery");

    const field = await screen.findByRole("textbox", { name: "Recovery Code" });
    fireEvent.change(field, { target: { value: "abcd-efgh-jkmn-pqrs" } });
    fireEvent.click(screen.getByRole("button", { name: "Use Code" }));

    await waitFor(() => {
      expect(alertsSaying()).toEqual([SAID_OF_SECOND_FACTOR["recovery-code-wrong"]]);
    });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(
      within(main()).getByRole("link", { name: "Use Your Passkey or Authenticator Instead" }),
    ).toBeDefined();
    expect(main().textContent).toContain(RECOVERY_WORDS.operator);
  });
});
