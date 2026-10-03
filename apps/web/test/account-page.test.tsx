import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";

import { openApp } from "./open-app.tsx";
import { addressOf, answered } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SESSION = { session: { id: "s" }, user: { id: "p", name: "Ada", email: "ada@example.test" } };

/** An authenticator set up and no codes held, so the page offers a first set. */
const NO_SET = {
  mustHoldOne: false,
  passkeys: [],
  authenticator: "set-up",
  passkeyOfferDismissed: false,
};

const A_SET = { ...NO_SET, recoveryCodes: { unused: 10, madeAt: "2026-10-02T09:41:00.000Z" } };

const ISSUED = {
  result: {
    data: { recoveryCodes: ["abcd-efgh-jkmn-pqrs"], madeAt: "2026-10-02T09:41:00.000Z" },
  },
};

const HELD = {
  error: {
    message: "recovery-codes-held",
    code: -32_009,
    data: {
      code: "CONFLICT",
      httpStatus: 409,
      refusal: { word: "recovery-codes-held", class: "conflict" },
    },
  },
};

/** Ada's api: `replace` answers making codes, and `read` her second factor each time it is read. */
const adasApi =
  (replace: () => unknown, read: () => unknown) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(SESSION);
    const names = pathname.replace("/trpc/", "").split(",");
    return answered(
      names.map((name) =>
        name === "person.replaceRecoveryCodes" ? replace() : { result: { data: read() } },
      ),
    );
  };

/** The session is held before the page opens: the auth library's own read never settles here. */
const makeCodesPressed = async () => {
  const clients = createAppClients();
  clients.queryClient.setQueryData(["auth", "session"], SESSION);
  await openApp("/account", clients);
  fireEvent.click(await screen.findByRole("button", { name: "Make recovery codes" }));
};

const A_PASSKEY = {
  id: "01K6AAAAAAAAAAAAAAAAAAAAAA",
  name: "MacBook",
  createdAt: "2026-03-03T10:00:00.000Z",
  lastUsedAt: null,
};

/** An Admin whose one factor is a passkey, and no authenticator. */
const ADMINS_ONLY_FACTOR = {
  mustHoldOne: true,
  passkeys: [A_PASSKEY],
  authenticator: "none",
  passkeyOfferDismissed: false,
  recoveryCodes: { unused: 10, madeAt: "2026-03-03T10:00:00.000Z" },
};

const accountOpened = async (held: unknown) => {
  vi.stubGlobal(
    "fetch",
    adasApi(
      () => ISSUED,
      () => held,
    ),
  );
  const clients = createAppClients();
  clients.queryClient.setQueryData(["auth", "session"], SESSION);
  await openApp("/account", clients);
};

describe("the Account page's passkeys", () => {
  it("lists each by name, with when it was added", async () => {
    await accountOpened(ADMINS_ONLY_FACTOR);

    const row = await screen.findByRole("listitem", { name: "MacBook" });

    expect(row.textContent).toContain("Added 3 March 2026 · Not used yet");
  });

  it("keeps an Admin's only factor, saying why beside Remove", async () => {
    await accountOpened(ADMINS_ONLY_FACTOR);

    const remove = await screen.findByRole("button", { name: "Remove" });

    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.getAttribute("aria-describedby")).not.toBeNull();
    expect(
      screen.getByText(
        "You must keep one passkey or authenticator. Add another before removing this one.",
      ),
    ).toBeDefined();
  });

  it("says there are none, and this browser adds none", async () => {
    await accountOpened(NO_SET);

    expect(
      await screen.findByText(
        "No passkeys yet. A passkey signs you in with your fingerprint, face or device PIN, with no email.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText("This browser can't add a passkey. Use another browser or device."),
    ).toBeDefined();
  });
});

describe("making a first set on the Account page", () => {
  it("says a notice is on its way", async () => {
    vi.stubGlobal(
      "fetch",
      adasApi(
        () => ISSUED,
        () => NO_SET,
      ),
    );

    await makeCodesPressed();

    expect(
      await screen.findByText("Recovery codes made. A notice is on its way to ada@example.test."),
    ).toBeDefined();
  });

  it("offers Replace once another tab made a set", async () => {
    let refused = false;
    vi.stubGlobal(
      "fetch",
      adasApi(
        () => {
          refused = true;
          return HELD;
        },
        () => (refused ? A_SET : NO_SET),
      ),
    );

    await makeCodesPressed();

    expect(await screen.findByRole("button", { name: "Replace recovery codes" })).toBeDefined();
    expect(
      screen.getByText(
        "You already have recovery codes, made in another tab or window. Replace them if you need new ones.",
      ),
    ).toBeDefined();
  });
});
