import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adasApi,
  answering,
  BOTH_HELD,
  CODES,
  MADE_AT,
  NOTHING_HELD,
  loadedAsAda,
  openAsAda,
  sessionStanding,
  withPasskeysHere,
} from "./second-factor-api.ts";

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

    expect(await screen.findByText("Scan this QR code with your authenticator.")).toBeDefined();
    expect(asked).toContain("/authenticator/start");
  });

  it("opens the authenticator's steps where no passkey can be made", async () => {
    adasApi(() => NOTHING_HELD, new Map([["/authenticator/start", answering(A_KEY)]]));
    await openAsAda("/setup");

    expect(await screen.findByText("Scan this QR code with your authenticator.")).toBeDefined();
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

  it("replaces the factors after a recovery code, ending on codes", async () => {
    const asked = adasApi(
      () => ({ ...BOTH_HELD, thisSession: sessionStanding("setup", { setupGranted: true }) }),
      new Map([
        ["/second-factor/replace/authenticator-start", answering(A_KEY)],
        ["/second-factor/replace/authenticator-finish", answering(ISSUED)],
      ]),
    );
    await openAsAda("/setup");

    expect(
      await screen.findByText(
        "Your recovery code worked. When you finish, your old passkeys and authenticator stop working and you get new recovery codes.",
      ),
    ).toBeDefined();
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

describe("the recovery codes detour", () => {
  const CONFIRMED = {
    ...BOTH_HELD,
    thisSession: sessionStanding("confirmed", { confirmed: true }),
  };
  const UNSEEN = { ...CONFIRMED, codesAcknowledged: false };

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
    expect(
      screen.getByText("These replace the codes shown before, which no longer work."),
    ).toBeDefined();

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
    expect(
      screen.queryByText("These replace the codes shown before, which no longer work."),
    ).toBeNull();
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
