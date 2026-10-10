import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { THEME_WORDS } from "@/features/auth/account-words.ts";
import { THEME_KEPT_UNDER } from "@/shared/theme-switch.ts";

import { openApp } from "./open-app.tsx";
import {
  adasApi as adasRoutes,
  answering,
  BOTH_HELD,
  NOTHING_HELD,
  openAsAda,
  sessionStanding,
} from "./second-factor-api.ts";
import { addressOf, answered } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
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

type Formatted = { readonly code: string; readonly httpStatus: number; readonly rpc: number };

/** A refusal as the router's error formatter sends it. */
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

/** Ada is in no workspace, so the Account page draws outside the shell. */
const FORBIDDEN = refusing("forbidden", "forbidden", {
  code: "FORBIDDEN",
  httpStatus: 403,
  rpc: -32_003,
});

const answerTo = (name: string, replace: () => unknown, read: () => unknown): unknown => {
  if (name === "person.replaceRecoveryCodes") return replace();
  return name === "person.secondFactor" ? { result: { data: read() } } : FORBIDDEN;
};

/** Ada's api: `replace` answers making codes, and `read` her second factor each time it is read. */
const adasApi =
  (replace: () => unknown, read: () => unknown) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(SESSION);
    const names = pathname.replace("/trpc/", "").split(",");
    return answered(names.map((name) => answerTo(name, replace, read)));
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
      screen.getByText("This browser can’t add a passkey. Use another browser or device."),
    ).toBeDefined();
  });
});

describe("the Account page's theme", () => {
  it("matches this device until a theme is picked", async () => {
    await accountOpened(NO_SET);

    const theme = await screen.findByRole("radiogroup", { name: THEME_WORDS.heading });
    const device = screen.getByRole("radio", { name: THEME_WORDS.device });

    expect(theme.getAttribute("aria-describedby")).not.toBeNull();
    expect(device.getAttribute("aria-checked")).toBe("true");
  });

  it("paints and keeps the theme picked", async () => {
    await accountOpened(NO_SET);

    fireEvent.click(await screen.findByRole("radio", { name: THEME_WORDS.dark }));

    expect(screen.getByRole("radio", { name: THEME_WORDS.dark }).getAttribute("aria-checked")).toBe(
      "true",
    );
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

    fireEvent.click(await screen.findByRole("button", { name: "Set up an authenticator" }));

    expect(await screen.findByText("Scan this QR code with your authenticator.")).toBeDefined();
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

  it("asks a restored sign-in for its restore code first", async () => {
    vi.stubGlobal(
      "fetch",
      adasApi(
        () => RESTORED,
        () => NO_SET,
      ),
    );

    await makeCodesPressed();

    expect(
      await screen.findByText(
        "Your sign-in was restored, so its restore code comes first. Enter the code better-answers support gave you.",
      ),
    ).toBeDefined();
  });
});
