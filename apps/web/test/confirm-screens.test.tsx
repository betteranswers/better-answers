import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";

import {
  A_CHALLENGE,
  adasApi,
  alertsSaying,
  answering,
  BOTH_HELD,
  openAsAda,
  readingForever,
  refusing,
  withPasskeysHere,
} from "./second-factor-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

const main = () => screen.getByRole("main");

/** Every control a keyboard meets on the screen, in document order. */
const controls = (): readonly Element[] => [...main().querySelectorAll("a, button, input")];

const CONFIRMED = { ...BOTH_HELD, thisSession: { confirmed: true, setupGranted: false } };

const GRANTED = { ...BOTH_HELD, thisSession: { confirmed: false, setupGranted: true } };

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

describe("the confirm screen", () => {
  it("shows only its heading and Sign out while reading", async () => {
    readingForever();

    await openAsAda("/confirm");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Confirm it's you");
    expect(controls().map((control) => control.textContent)).toEqual(["Sign out"]);
  });

  it("orders passkey (focused), code, recovery code, then Sign out", async () => {
    withPasskeysHere();
    adasApi(() => BOTH_HELD);

    await openAsAda("/confirm");

    const passkey = await screen.findByRole("button", { name: "Use your passkey" });
    const ways: readonly Element[] = [
      passkey,
      screen.getByRole("textbox", { name: "Authenticator code" }),
      screen.getByRole("link", { name: "Use a recovery code" }),
      screen.getByRole("button", { name: "Sign out" }),
    ];
    expect(document.activeElement).toBe(passkey);
    expect(controls().filter((control) => ways.includes(control))).toEqual(ways);
    expect(controls().at(-1)).toBe(ways[3]);
  });

  it("names the wait once throttled, and the passkey still confirms", async () => {
    withPasskeysHere();
    const asked = confirmingByPasskey(refusing(429, "too_many_requests", 240));
    const { router } = await openAsAda("/confirm");

    const field = await screen.findByRole("textbox", { name: "Authenticator code" });
    fireEvent.change(field, { target: { value: "123 456" } });

    await waitFor(() => {
      expect(alertsSaying()).toEqual([
        "Too many codes have been tried. Try again in 4 minutes, or use your passkey or a recovery code.",
      ]);
    });
    expect(field.hasAttribute("readonly")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Use your passkey" }));

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

    const field = await screen.findByRole("textbox", { name: "Authenticator code" });
    expect(alertsSaying()).toEqual([
      "Too many codes have been tried. Try again in a minute, or use a recovery code.",
    ]);
    expect(field.hasAttribute("readonly")).toBe(true);

    expect(
      await screen.findByText("You can enter a code again.", {}, { timeout: 3000 }),
    ).toBeDefined();
    expect(field.hasAttribute("readonly")).toBe(false);
    expect(alertsSaying()).toEqual([]);
  });

  it("offers Try again when the read goes unanswered", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));

    await openAsAda("/confirm");

    expect(
      await screen.findByText("No response, so nothing is shown. Try again in a moment."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(screen.getByRole("button", { name: KEYSTROKE_WORDS.button })).toBeDefined();
  });

  it("keeps a wrong code's digits selected and marks it invalid", async () => {
    adasApi(
      () => BOTH_HELD,
      new Map([["/second-factor/confirm/authenticator", refusing(400, "code-wrong")]]),
    );
    await openAsAda("/confirm");

    const field = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "Authenticator code",
    });
    fireEvent.change(field, { target: { value: "123456" } });

    await waitFor(() => {
      expect(field.getAttribute("aria-invalid")).toBe("true");
    });
    expect(alertsSaying()).toEqual([
      "That code is wrong. Enter the code your authenticator shows now.",
    ]);
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

describe("the recovery screen", () => {
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

    const field = await screen.findByRole("textbox", { name: "Recovery code" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "ABCD efgh-jkmn-pqrs" } });
    fireEvent.click(screen.getByRole("button", { name: "Use code" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup");
    });
    expect(router.state.location.search).toEqual({ redirect: "/people/members" });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Set up a new second factor" }),
    ).toBeDefined();
  });

  it("says a wrong code, and offers the way back last", async () => {
    adasApi(
      () => BOTH_HELD,
      new Map([["/second-factor/recovery", refusing(400, "recovery-code-wrong")]]),
    );
    await openAsAda("/recovery");

    const field = await screen.findByRole("textbox", { name: "Recovery code" });
    fireEvent.change(field, { target: { value: "abcd-efgh-jkmn-pqrs" } });
    fireEvent.click(screen.getByRole("button", { name: "Use code" }));

    await waitFor(() => {
      expect(alertsSaying()).toEqual([
        "That code is wrong or already used. Check it, or try another code.",
      ]);
    });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(
      within(main()).getByRole("link", { name: "Use your passkey or authenticator instead" }),
    ).toBeDefined();
    expect(main().textContent).toContain(
      "No codes left? Ask better-answers support to restore your sign-in. They check who you are another way first.",
    );
  });
});
