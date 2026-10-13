import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTHENTICATOR_WORDS, RECOVERY_CODE_WORDS } from "@/features/auth/account-words.ts";
import { SETUP_WORDS } from "@/features/auth/second-factor-words.ts";
import { STOCK } from "@/shared/refusal-words.ts";

import {
  adasApi,
  alertsSaying,
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
} from "./second-factor-api.ts";
import { addressOf } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

const A_KEY = { setupAddress: "otpauth://totp/better-answers:ada?secret=JBSWY3DPEHPK3PXP" };

const ISSUED = { recoveryCodes: CODES, madeAt: MADE_AT };

const heading = () => screen.getByRole("heading", { level: 1 });

const disclosure = () => screen.getByRole("button", { name: "Set up an authenticator instead" });

/** The authenticator's setup, opened if it is not yet, then finished with a working code. */
const finishTheAuthenticator = async () => {
  if (disclosure().getAttribute("aria-expanded") === "false") fireEvent.click(disclosure());
  const field = await screen.findByRole("textbox", { name: "Code from your authenticator" });
  fireEvent.change(field, { target: { value: "123456" } });
};

/** The setup page where a passkey can be made, drawn as far as its passkey field. */
const openedWithBothWays = async () => {
  withPasskeysHere();
  adasApi(() => NOTHING_HELD, new Map([["/authenticator/start", answering(A_KEY)]]));
  await openAsAda("/setup");
  return screen.findByRole("textbox", { name: "Passkey name" });
};

describe("the setup page", () => {
  it("offers a first passkey, then the authenticator behind a disclosure", async () => {
    withPasskeysHere();
    const asked = adasApi(
      () => NOTHING_HELD,
      new Map([["/authenticator/start", answering(A_KEY)]]),
    );
    await openAsAda("/setup");

    const name = await screen.findByRole("textbox", { name: "Passkey name" });
    expect(heading().textContent).toBe("Set up a second factor");
    expect(document.activeElement).toBe(name);
    expect(screen.getByRole("button", { name: "Add a passkey" })).toBeDefined();
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(disclosure());

    expect(await screen.findByText(AUTHENTICATOR_WORDS.scan)).toBeDefined();
    expect(asked).toContain("/authenticator/start");
  });

  it("opens the authenticator's steps where no passkey can be made", async () => {
    adasApi(() => NOTHING_HELD, new Map([["/authenticator/start", answering(A_KEY)]]));
    await openAsAda("/setup");

    expect(await screen.findByText(AUTHENTICATOR_WORDS.scan)).toBeDefined();
    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("textbox", { name: "Passkey name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a passkey" })).toBeNull();
  });

  it("collapses the passkey form while the authenticator is open", async () => {
    const name = await openedWithBothWays();
    fireEvent.change(name, { target: { value: "Work laptop" } });

    fireEvent.click(disclosure());

    expect(await screen.findByRole("button", { name: "Finish setup" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add a passkey" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Passkey name" })).toBeNull();

    fireEvent.click(disclosure());

    expect(screen.queryByRole("button", { name: "Finish setup" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add a passkey" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Passkey name" })).toHaveProperty(
      "value",
      "Work laptop",
    );
  });

  it("opens and closes the authenticator on its listed keystroke", async () => {
    await openedWithBothWays();

    fireEvent.keyDown(document.body, { key: "s" });

    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document.body, { key: "?" });
    const listed = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts on Set up a second factor",
    });
    expect(within(listed).getByText("Set up an authenticator instead")).toBeDefined();

    fireEvent.keyDown(document.body, { key: "s" });

    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Add a passkey" })).toBeDefined();
  });

  it("keeps focus when its keystroke hides the focused part", async () => {
    await openedWithBothWays();
    const add = screen.getByRole("button", { name: "Add a passkey" });
    add.focus();

    fireEvent.keyDown(add, { key: "s" });

    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(disclosure());
  });

  it("replaces the factors after a recovery code, ending on codes", async () => {
    const asked = adasApi(
      () => ({ ...BOTH_HELD, thisSession: sessionStanding("setup", { setupGranted: true }) }),
      new Map([
        ["/second-factor/replace/authenticator-start", answering(A_KEY)],
        ["/second-factor/replace/authenticator-finish", answering(ISSUED)],
      ]),
    );
    await openAsAda("/setup");

    expect(await screen.findByText(SETUP_WORDS.newWhy)).toBeDefined();
    expect(heading().textContent).toBe("Set up a new second factor");
    await finishTheAuthenticator();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Save your recovery codes" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Finish setup" })).toBeDefined();
    expect(asked).not.toContain("/authenticator/start");
    expect(asked).not.toContain("/authenticator/finish");
  });

  it("asks a restored person's restore code before anything else", async () => {
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

    const field = await screen.findByRole("textbox", { name: "Restore code" });
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole("textbox", { name: "Passkey name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up an authenticator instead" })).toBeNull();

    fireEvent.change(field, { target: { value: "rstr-code-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Use code" }));

    const name = await screen.findByRole("textbox", { name: "Passkey name" });
    expect(document.activeElement).toBe(name);
    expect(disclosure()).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Restore code" })).toBeNull();
  });

  it("sends a session holding factors, but no grant, to confirm", async () => {
    adasApi(() => BOTH_HELD);

    const { router } = await openAsAda("/setup?redirect=%2Fpeople%2Fmembers");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/confirm");
    });
    expect(router.state.location.search).toEqual({ redirect: "/people/members" });
    expect(screen.queryByRole("button", { name: "Add a passkey" })).toBeNull();
  });
});

const DROPPED: Route = () => Promise.reject(new TypeError("the network is down"));

/** Enough of an ask to add a passkey that the browser's library hands it to the device. */
const ASKED_TO_ADD = {
  challenge: "Y2hhbGxlbmdl",
  rp: { name: "better-answers" },
  user: { id: "cA", name: "ada@example.test", displayName: "Ada" },
  pubKeyCredParams: [],
};

/** A browser that can make a passkey, where the person closes the device's prompt. */
const withThePromptClosed = () => {
  const create = vi.fn<() => Promise<never>>(() =>
    Promise.reject(new DOMException("closed", "NotAllowedError")),
  );
  vi.stubGlobal("PublicKeyCredential", () => undefined);
  Object.defineProperty(navigator, "credentials", { value: { create }, configurable: true });
  return create;
};

/** The setup page with a key made, whose finish answers as `finish` does. */
const finishedWith = async (finish: Route) => {
  adasApi(
    () => NOTHING_HELD,
    new Map([
      ["/authenticator/start", answering(A_KEY)],
      ["/authenticator/finish", finish],
    ]),
  );
  await openAsAda("/setup");
  await screen.findByRole("button", { name: "Finish setup" });
  await finishTheAuthenticator();
};

describe("what the setup page says of a failed setup", () => {
  it("cannot confirm a finish that got no response", async () => {
    await finishedWith(DROPPED);

    await waitFor(() => {
      expect(alertsSaying()).toEqual([STOCK.unconfirmed]);
    });
  });

  it("shows the general sentence for a status with no branch", async () => {
    await finishedWith(refusing(403, "forbidden"));

    await waitFor(() => {
      expect(alertsSaying()).toEqual([STOCK.general]);
    });
  });

  it("leaves the alert empty when the device cancels an add", async () => {
    const create = withThePromptClosed();
    adasApi(() => NOTHING_HELD, new Map([["/passkeys/add-options", answering(ASKED_TO_ADD)]]));
    await openAsAda("/setup");

    const add = await screen.findByRole("button", { name: "Add a passkey" });
    fireEvent.click(add);

    await waitFor(() => {
      expect(create).toHaveBeenCalledOnce();
      expect(add.getAttribute("aria-disabled")).toBe("false");
    });
    expect(alertsSaying()).toEqual([]);
  });
});

const CONFIRMED = {
  ...BOTH_HELD,
  thisSession: sessionStanding("confirmed", { confirmed: true }),
};

const UNSEEN = { ...CONFIRMED, codesAcknowledged: false };

describe("the recovery codes detour", () => {
  it("shows a new set that replaces the one shown before", async () => {
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

    const list = await screen.findByRole("list", { name: "Recovery codes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(heading().textContent).toBe("Save your recovery codes");
    expect(screen.getByText(RECOVERY_CODE_WORDS.replacedLine)).toBeDefined();

    fireEvent.click(screen.getByRole("checkbox", { name: "I have saved these codes" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

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

  it("gives a first set to an Admin holding no codes", async () => {
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

    const list = await screen.findByRole("list", { name: "Recovery codes" });
    expect([within(list).getAllByRole("listitem").length, asked]).toEqual([10, ["made"]]);
    expect(screen.queryByText(RECOVERY_CODE_WORDS.replacedLine)).toBeNull();
  });

  it("passes to the display-name step once the set is seen", async () => {
    adasApi(() => CONFIRMED);

    const { router } = await loadedAsAda("/recovery-codes");

    expect(router.state.location.pathname).toBe("/display-name");
  });

  it("catches a link's sign-in while a set is unseen", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/recovery-codes");
    });
  });
});

/** Ada's api as `held` says, where the call that makes a set of codes gets no response. */
const withTheMakeDropped = (held: () => unknown): void => {
  adasApi(held);
  const answer = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request) =>
    addressOf(input).pathname.includes("person.replaceRecoveryCodes")
      ? Promise.reject(new TypeError("the network is down"))
      : answer(input),
  );
};

/** Free to hold no codes, so the Account page offers a first set and no detour makes one. */
const NO_CODES_YET = { ...CONFIRMED, mustHoldOne: false, recoveryCodes: undefined };

describe("a set of recovery codes whose making got no response", () => {
  it("says to try again on the setup's own step", async () => {
    withTheMakeDropped(() => UNSEEN);

    await openAsAda("/recovery-codes");

    await waitFor(() => {
      expect(alertsSaying()).toEqual([STOCK.tryAgain]);
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("cannot be confirmed on the Account page", async () => {
    withTheMakeDropped(() => NO_CODES_YET);
    await openAsAda("/account");

    fireEvent.click(await screen.findByRole("button", { name: "Make recovery codes" }));

    await waitFor(() => {
      expect(alertsSaying()).toEqual([STOCK.unconfirmed]);
    });
  });
});
