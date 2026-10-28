import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import {
  ACTION_LANDED,
  AUTHENTICATOR_WORDS,
  PASSKEY_WORDS,
} from "@/features/auth/account-words.ts";
import { SAID_OF_SECOND_FACTOR } from "@/features/auth/refusal-words.ts";
import { THEME_KEPT_UNDER } from "@/shared/theme/theme-switch.ts";
import { openApp } from "@test/open-app.tsx";
import {
  adasApi as adasRoutes,
  answering,
  BOTH_HELD,
  NOTHING_HELD,
  openAsAda,
  sessionStanding,
  withPasskeysHere,
} from "@test/second-factor-api.ts";
import { addressOf, answered } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

const SESSION = { session: { id: "s" }, user: { id: "p", name: "Ada", email: "ada@example.test" } };

const SIGNED_IN_AS_ADA = {
  session: { id: "s", workspaceId: undefined },
  person: { email: "ada@example.test", displayName: "Ada" },
};

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

type Formatted = { readonly code: string; readonly httpStatus: number; readonly rpc: number };

const refusing = (word: string, refusalClass: string, formatted: Formatted) => ({
  error: {
    message: word,
    code: formatted.rpc,
    data: {
      code: formatted.code,
      httpStatus: formatted.httpStatus,
      refusal: { word, class: refusalClass },
    },
  },
});

const HELD = refusing("recovery-codes-held", "conflict", {
  code: "CONFLICT",
  httpStatus: 409,
  rpc: -32_009,
});

const RESTORED = refusing("restore-code-needed", "precondition", {
  code: "PRECONDITION_FAILED",
  httpStatus: 412,
  rpc: -32_012,
});

const FORBIDDEN = refusing("forbidden", "forbidden", {
  code: "FORBIDDEN",
  httpStatus: 403,
  rpc: -32_003,
});

const answerTo = (name: string, replace: () => unknown, read: () => unknown): unknown => {
  if (name === "person.replaceRecoveryCodes") return replace();
  return name === "person.secondFactor" ? { result: { data: read() } } : FORBIDDEN;
};

const adasApi =
  (replace: () => unknown, read: () => unknown) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(SESSION);
    const names = pathname.replace("/trpc/", "").split(",");
    return answered(names.map((name) => answerTo(name, replace, read)));
  };

const anotherTabMadeASet = () => {
  let refused = false;
  return adasApi(
    () => {
      refused = true;
      return HELD;
    },
    () => (refused ? A_SET : NO_SET),
  );
};

/** The session is held before the page opens: the auth library's own read never settles here. */
const makeCodesPressed = async () => {
  const clients = createAppClients();
  clients.queryClient.setQueryData(["auth", "session"], SIGNED_IN_AS_ADA);
  await openApp("/account", clients);
  fireEvent.click(await screen.findByRole("button", { name: "Make Recovery Codes" }));
};

const A_PASSKEY = {
  id: "01K6AAAAAAAAAAAAAAAAAAAAAA",
  name: "MacBook",
  createdAt: "2026-03-03T10:00:00.000Z",
  lastUsedAt: null,
};

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
  clients.queryClient.setQueryData(["auth", "session"], SIGNED_IN_AS_ADA);
  await openApp("/account", clients);
};

describe("the Account page's passkeys", () => {
  it("lists each by name, with when it was added", async () => {
    await accountOpened(ADMINS_ONLY_FACTOR);

    const row = await screen.findByRole("listitem", { name: "MacBook" });

    expect(row.textContent).toContain("3 March 2026");
    expect(row.textContent).toContain(PASSKEY_WORDS.notUsed);
  });

  it("keeps an Admin's only factor, saying why beside Remove", async () => {
    await accountOpened(ADMINS_ONLY_FACTOR);

    const remove = await screen.findByRole("button", { name: "Remove" });

    expect(remove.getAttribute("aria-disabled")).toBe("true");
    const describedBy = remove.getAttribute("aria-describedby");
    assert(describedBy !== null, "Remove is described by a reason");
    const reason = document.getElementById(describedBy);
    expect(reason?.textContent).toBe(SAID_OF_SECOND_FACTOR["last-second-factor"]);
  });

  it("says there are none, and this browser adds none", async () => {
    await accountOpened(NO_SET);

    expect(await screen.findByText(PASSKEY_WORDS.none)).toBeDefined();
    expect(screen.getByText(PASSKEY_WORDS.noWebAuthn)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add a Passkey" })).toBeNull();
  });

  it("offers to add one where this browser can", async () => {
    withPasskeysHere();
    await accountOpened(NO_SET);

    expect(await screen.findByRole("button", { name: "Add a Passkey" })).toBeDefined();
    expect(screen.queryByText(PASSKEY_WORDS.noWebAuthn)).toBeNull();
  });
});

describe("the Account page's theme", () => {
  it("matches this device until a theme is picked", async () => {
    await accountOpened(NO_SET);

    const theme = await screen.findByRole("radiogroup", { name: "Theme" });
    const device = screen.getByRole("radio", { name: "Match this device" });

    expect(theme.getAttribute("aria-describedby")).not.toBeNull();
    expect(device.getAttribute("aria-checked")).toBe("true");
  });

  it("paints and keeps the theme picked", async () => {
    await accountOpened(NO_SET);

    fireEvent.click(await screen.findByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(localStorage.getItem(THEME_KEPT_UNDER)).toBe("dark");
  });
});

describe("setting up an authenticator on the Account page", () => {
  it("replaces the factors for a session a code granted", async () => {
    const asked = adasRoutes(
      () => ({
        ...NOTHING_HELD,
        mustHoldOne: false,
        recoveryCodes: BOTH_HELD.recoveryCodes,
        thisSession: sessionStanding("not-required", { setupGranted: true }),
      }),
      new Map([
        [
          "/second-factor/replace/authenticator-start",
          answering({ setupAddress: "otpauth://totp/better-answers:ada?secret=JBSWY3DPEHPK3PXP" }),
        ],
      ]),
    );
    await openAsAda("/account");

    fireEvent.click(await screen.findByRole("button", { name: "Set Up an Authenticator" }));

    expect(await screen.findByText(AUTHENTICATOR_WORDS.scan)).toBeDefined();
    expect(asked).toContain("/second-factor/replace/authenticator-start");
    expect(asked).not.toContain("/authenticator/start");
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

    const landed = await screen.findByText(ACTION_LANDED.made(SESSION.user.email));
    expect(landed.textContent).toContain(SESSION.user.email);
  });

  it("offers Replace once another tab made a set", async () => {
    vi.stubGlobal("fetch", anotherTabMadeASet());

    await makeCodesPressed();

    expect(await screen.findByRole("button", { name: "Replace Recovery Codes" })).toBeDefined();
    expect(screen.getByText(SAID_OF_SECOND_FACTOR["recovery-codes-held"])).toBeDefined();
  });

  it("asks a restored sign-in for its restore code first", async () => {
    vi.stubGlobal(
      "fetch",
      adasApi(
        () => RESTORED,
        () => NO_SET,
      ),
    );

    await makeCodesPressed();

    expect(await screen.findByText(SAID_OF_SECOND_FACTOR["restore-code-needed"])).toBeDefined();
  });
});
