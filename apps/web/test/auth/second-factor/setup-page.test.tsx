import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FAILED_PAGE, UNKNOWN_PAGE } from "@/app/words.ts";
import {
  AUTHENTICATOR_WORDS,
  PASSKEY_WORDS,
  RECOVERY_CODE_WORDS,
} from "@/features/auth/account-words.ts";
import { SETUP_WORDS, USE_CODE } from "@/features/auth/second-factor/second-factor-words.ts";
import { keystrokesOn } from "@/shared/keystroke-words.ts";
import {
  adasApi,
  alertTexts,
  answering,
  BOTH_HELD,
  CODES,
  MADE_AT,
  NOTHING_HELD,
  loadedAsAda,
  openAsAda,
  refusing,
  sessionStanding,
  withPasskeysHere,
  type Route,
} from "@test/second-factor-api.ts";
import { addressOf } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

const A_KEY = { setupAddress: "otpauth://totp/better-answers:ada?secret=JBSWY3DPEHPK3PXP" };

const ISSUED = { recoveryCodes: CODES, madeAt: MADE_AT };

const heading = () => screen.getByRole("heading", { level: 1 });

const qrCode = () => screen.findByRole("img", { name: "QR code for your authenticator app" });

const notesAboveTheCodes = () =>
  within(screen.getByRole("region", { name: RECOVERY_CODE_WORDS.saveHeading })).queryAllByRole(
    "paragraph",
  );

const ONE_ALERT_WITH_WORDS = [expect.stringMatching(/\S/u)];

const disclosure = () => screen.getByRole("button", { name: SETUP_WORDS.authenticatorInstead });

const finishTheAuthenticator = async () => {
  if (disclosure().getAttribute("aria-expanded") === "false") fireEvent.click(disclosure());
  const field = await screen.findByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });
  fireEvent.change(field, { target: { value: "123456" } });
};

const openedWithBothWays = async () => {
  withPasskeysHere();
  adasApi(() => NOTHING_HELD, new Map([["/authenticator/start", answering(A_KEY)]]));
  await openAsAda("/setup");
  return screen.findByRole("textbox", { name: PASSKEY_WORDS.nameField });
};

describe("the setup page", () => {
  it("offers a first passkey, then the authenticator behind a disclosure", async () => {
    withPasskeysHere();
    const asked = adasApi(
      () => NOTHING_HELD,
      new Map([["/authenticator/start", answering(A_KEY)]]),
    );
    await openAsAda("/setup");

    const name = await screen.findByRole("textbox", { name: PASSKEY_WORDS.nameField });
    expect(heading().textContent).toBe(SETUP_WORDS.heading);
    expect(document.activeElement).toBe(name);
    expect(screen.getByRole("button", { name: SETUP_WORDS.addPasskey })).toBeDefined();
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(disclosure());

    expect(await qrCode()).toBeDefined();
    expect(asked).toContain("/authenticator/start");
  });

  it("opens the authenticator steps when the browser lacks passkeys", async () => {
    adasApi(() => NOTHING_HELD, new Map([["/authenticator/start", answering(A_KEY)]]));
    await openAsAda("/setup");

    expect(await qrCode()).toBeDefined();
    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("textbox", { name: PASSKEY_WORDS.nameField })).toBeNull();
    expect(screen.queryByRole("button", { name: SETUP_WORDS.addPasskey })).toBeNull();
  });

  it("collapses the passkey form while the authenticator is open", async () => {
    const name = await openedWithBothWays();
    fireEvent.change(name, { target: { value: "Work laptop" } });

    fireEvent.click(disclosure());

    expect(await screen.findByRole("button", { name: AUTHENTICATOR_WORDS.finish })).toBeDefined();
    expect(screen.queryByRole("button", { name: SETUP_WORDS.addPasskey })).toBeNull();
    expect(screen.queryByRole("textbox", { name: PASSKEY_WORDS.nameField })).toBeNull();

    fireEvent.click(disclosure());

    expect(screen.queryByRole("button", { name: AUTHENTICATOR_WORDS.finish })).toBeNull();
    expect(screen.getByRole("button", { name: SETUP_WORDS.addPasskey })).toBeDefined();
    expect(screen.getByRole("textbox", { name: PASSKEY_WORDS.nameField })).toHaveProperty(
      "value",
      "Work laptop",
    );
  });

  it("opens and closes the authenticator steps with the S key", async () => {
    await openedWithBothWays();

    fireEvent.keyDown(document.body, { key: "s" });

    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document.body, { key: "?" });
    const listed = await screen.findByRole("dialog", {
      name: keystrokesOn(SETUP_WORDS.heading),
    });
    expect(within(listed).getByText(SETUP_WORDS.authenticatorInstead)).toBeDefined();

    fireEvent.keyDown(document.body, { key: "s" });

    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: SETUP_WORDS.addPasskey })).toBeDefined();
  });

  it("focuses the disclosure when S hides the focused button", async () => {
    await openedWithBothWays();
    const add = screen.getByRole("button", { name: SETUP_WORDS.addPasskey });
    add.focus();

    fireEvent.keyDown(add, { key: "s" });

    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(disclosure());
  });

  it("after a recovery code, replaces factors and shows new codes", async () => {
    const asked = adasApi(
      () => ({ ...BOTH_HELD, thisSession: sessionStanding("setup", { setupGranted: true }) }),
      new Map([
        ["/second-factor/replace/authenticator-start", answering(A_KEY)],
        ["/second-factor/replace/authenticator-finish", answering(ISSUED)],
      ]),
    );
    await openAsAda("/setup");

    expect(
      await screen.findByRole("heading", { level: 1, name: SETUP_WORDS.newHeading }),
    ).toBeDefined();
    await finishTheAuthenticator();

    expect(
      await screen.findByRole("heading", { level: 1, name: RECOVERY_CODE_WORDS.saveHeading }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: AUTHENTICATOR_WORDS.finish })).toBeDefined();
    expect(asked).not.toContain("/authenticator/start");
    expect(asked).not.toContain("/authenticator/finish");
  });

  it("asks for the restore code before offering a second factor", async () => {
    withPasskeysHere();
    let accepted = false;
    const restored = { ...NOTHING_HELD, restoreRequired: true };
    adasApi(
      () => ({ ...restored, thisSession: sessionStanding("setup", { setupGranted: accepted }) }),
      new Map([
        [
          "/second-factor/restore",
          () => {
            accepted = true;
            return answering({ granted: true })();
          },
        ],
      ]),
    );
    await openAsAda("/setup");

    const field = await screen.findByRole("textbox", { name: SETUP_WORDS.restoreField });
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole("textbox", { name: PASSKEY_WORDS.nameField })).toBeNull();
    expect(screen.queryByRole("button", { name: SETUP_WORDS.authenticatorInstead })).toBeNull();

    fireEvent.change(field, { target: { value: "rstr-code-0000" } });
    fireEvent.click(screen.getByRole("button", { name: USE_CODE }));

    const name = await screen.findByRole("textbox", { name: PASSKEY_WORDS.nameField });
    expect(document.activeElement).toBe(name);
    expect(disclosure()).toBeDefined();
    expect(screen.queryByRole("textbox", { name: SETUP_WORDS.restoreField })).toBeNull();
  });

  it("sends a person with factors but no grant to confirm", async () => {
    adasApi(() => BOTH_HELD);

    const { router } = await openAsAda("/setup?redirect=%2Fpeople%2Fmembers");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/confirm");
    });
    expect(router.state.location.search).toEqual({ redirect: "/people/members" });
    expect(screen.queryByRole("button", { name: SETUP_WORDS.addPasskey })).toBeNull();
  });
});

const DROPPED: Route = () => Promise.reject(new TypeError("the network is down"));

const ASKED_TO_ADD = {
  challenge: "Y2hhbGxlbmdl",
  rp: { name: "better-answers" },
  user: { id: "cA", name: "ada@example.test", displayName: "Ada" },
  pubKeyCredParams: [],
};

const withThePromptClosed = () => {
  const create = vi.fn<() => Promise<never>>(() =>
    Promise.reject(new DOMException("closed", "NotAllowedError")),
  );
  vi.stubGlobal("PublicKeyCredential", () => undefined);
  Object.defineProperty(navigator, "credentials", { value: { create }, configurable: true });
  return create;
};

const finishedWith = async (finish: Route) => {
  adasApi(
    () => NOTHING_HELD,
    new Map([
      ["/authenticator/start", answering(A_KEY)],
      ["/authenticator/finish", finish],
    ]),
  );
  await openAsAda("/setup");
  await screen.findByRole("button", { name: AUTHENTICATOR_WORDS.finish });
  await finishTheAuthenticator();
};

describe("a failed second factor setup", () => {
  it("shows an alert when the finish gets no response", async () => {
    await finishedWith(DROPPED);

    await waitFor(() => {
      expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    });
  });

  it("shows an alert for an unexpected refusal", async () => {
    await finishedWith(refusing(403, "forbidden"));

    await waitFor(() => {
      expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    });
  });

  it("shows no alert when the device cancels adding a passkey", async () => {
    const create = withThePromptClosed();
    adasApi(() => NOTHING_HELD, new Map([["/passkeys/add-options", answering(ASKED_TO_ADD)]]));
    await openAsAda("/setup");

    const add = await screen.findByRole("button", { name: SETUP_WORDS.addPasskey });
    fireEvent.click(add);

    await waitFor(() => {
      expect(create).toHaveBeenCalledOnce();
      expect(add.getAttribute("aria-disabled")).toBe("false");
    });
    expect(alertTexts()).toEqual([]);
  });
});

const CONFIRMED = {
  ...BOTH_HELD,
  thisSession: sessionStanding("confirmed", { confirmed: true }),
};

const UNSEEN = { ...CONFIRMED, codesAcknowledged: false };

describe("the recovery codes step", () => {
  it("shows a replacement set and records it on Finish Setup", async () => {
    const acknowledged: unknown[] = [];
    adasApi(
      () => UNSEEN,
      new Map(),
      new Map<string, () => unknown>([
        ["person.replaceRecoveryCodes", () => ({ ...ISSUED, replaced: true })],
        [
          "person.acknowledgeRecoveryCodes",
          () => {
            acknowledged.push(MADE_AT);
            return { acknowledged: true };
          },
        ],
      ]),
    );
    await openAsAda("/recovery-codes");

    const list = await screen.findByRole("list", { name: RECOVERY_CODE_WORDS.heading });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(heading().textContent).toBe(RECOVERY_CODE_WORDS.saveHeading);
    expect(
      notesAboveTheCodes(),
      "a replaced set does not say the old codes stopped working",
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: "I have saved these codes" }));
    fireEvent.click(screen.getByRole("button", { name: AUTHENTICATOR_WORDS.finish }));

    await waitFor(() => {
      expect(acknowledged).toEqual([MADE_AT]);
    });
  });

  it("comes before the display-name step", async () => {
    adasApi(() => UNSEEN);

    const { router } = await loadedAsAda("/display-name?redirect=%2Fpeople%2Fmembers");

    expect(router.state.location.pathname).toBe("/recovery-codes");
    expect(router.state.location.search).toEqual({ redirect: "/people/members" });
  });

  it("generates a first set for an Admin with no codes", async () => {
    const asked: unknown[] = [];
    adasApi(
      () => ({ ...CONFIRMED, recoveryCodes: undefined }),
      new Map(),
      new Map<string, () => unknown>([
        [
          "person.replaceRecoveryCodes",
          () => {
            asked.push("made");
            return { ...ISSUED, replaced: false };
          },
        ],
      ]),
    );
    await openAsAda("/display-name");

    const list = await screen.findByRole("list", { name: RECOVERY_CODE_WORDS.heading });
    expect([within(list).getAllByRole("listitem").length, asked]).toEqual([10, ["made"]]);
    expect(notesAboveTheCodes(), "a first set says old codes stopped working").toHaveLength(1);
  });

  it("goes to the display-name step once the codes are acknowledged", async () => {
    adasApi(() => CONFIRMED);

    const { router } = await loadedAsAda("/recovery-codes");

    expect(router.state.location.pathname).toBe("/display-name");
  });

  it("a sign-in link goes to unacknowledged recovery codes first", async () => {
    adasApi(
      () => UNSEEN,
      new Map([
        [
          "/sign-in-link/describe",
          answering({ state: "bound", address: "ada@example.test", carried: "" }),
        ],
        ["/sign-in-link/sign-in", answering({ displayNameGiven: true, carried: "" })],
      ]),
    );
    const { router } = await openAsAda("/sign-in/link#abc123");

    fireEvent.click(await screen.findByRole("button", { name: UNKNOWN_PAGE.signIn }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/recovery-codes");
    });
  });
});

const withGeneratingDropped = (held: () => unknown): void => {
  adasApi(held);
  const answer = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request) =>
    addressOf(input).pathname.includes("person.replaceRecoveryCodes")
      ? Promise.reject(new TypeError("the network is down"))
      : answer(input),
  );
};

const NO_CODES_YET = { ...CONFIRMED, mustHoldOne: false, recoveryCodes: undefined };

describe("generating recovery codes with no response", () => {
  it("offers Try Again on the recovery codes step", async () => {
    withGeneratingDropped(() => UNSEEN);

    await openAsAda("/recovery-codes");

    await waitFor(() => {
      expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    });
    expect(screen.getByRole("button", { name: FAILED_PAGE.retry })).toBeDefined();
  });

  it("shows an alert on the Account page", async () => {
    withGeneratingDropped(() => NO_CODES_YET);
    await openAsAda("/account");

    fireEvent.click(await screen.findByRole("button", { name: RECOVERY_CODE_WORDS.make }));

    await waitFor(() => {
      expect(alertTexts()).toEqual(ONE_ALERT_WITH_WORDS);
    });
  });
});
