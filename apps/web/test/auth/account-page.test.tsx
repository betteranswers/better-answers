import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { THEME_KEPT_UNDER } from "@/shared/theme/theme-switch.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { openApp } from "@test/open-app.tsx";
import {
  adasApi as adasRoutes,
  answering,
  BOTH_HELD,
  CODES,
  MADE_AT,
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

const anotherTabGeneratedCodes = () => {
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
const pressGenerateCodes = async () => {
  const clients = createAppClients();
  clients.queryClient.setQueryData(["auth", "session"], SIGNED_IN_AS_ADA);
  await openApp("/account", clients);
  fireEvent.click(await screen.findByRole("button", { name: "Generate Recovery Codes" }));
};

const signInAlertsWithWords = (): readonly HTMLElement[] =>
  within(screen.getByRole("region", { name: "Sign-In" }))
    .getAllByRole("alert")
    .filter((alert) => /\S/u.test(alert.textContent));

const paragraphsIn = (region: string): readonly HTMLElement[] =>
  within(screen.getByRole("region", { name: region })).queryAllByRole("paragraph");

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
  it("lists each by name, with the date it was added", async () => {
    await accountOpened(ADMINS_ONLY_FACTOR);

    const row = await screen.findByRole("listitem", { name: "MacBook" });

    expect(row.textContent).toContain("3 March 2026");
  });

  it("disables Remove on an Admin's only passkey and says why", async () => {
    await accountOpened(ADMINS_ONLY_FACTOR);

    const remove = await screen.findByRole("button", { name: "Remove" });

    expect(remove.getAttribute("aria-disabled")).toBe("true");
    const describedBy = remove.getAttribute("aria-describedby");
    assert(describedBy !== null, "the disabled Remove button has no reason");
    const reason = document.getElementById(describedBy);
    expect(reason?.textContent, "the disabled Remove button's reason is empty").toMatch(/\S/u);
  });

  it("explains why a browser without passkey support cannot add one", async () => {
    await accountOpened(NO_SET);

    await screen.findByRole("region", { name: "Passkeys" });
    const said = paragraphsIn("Passkeys");
    expect(said, "the Passkeys section does not explain both states").toHaveLength(2);
    for (const paragraph of said) expect(paragraph.textContent).toMatch(/\S/u);
    expect(screen.queryByRole("button", { name: "Add a Passkey" })).toBeNull();
  });

  it("offers Add a Passkey in a browser that supports passkeys", async () => {
    withPasskeysHere();
    await accountOpened(NO_SET);

    expect(await screen.findByRole("button", { name: "Add a Passkey" })).toBeDefined();
    expect(paragraphsIn("Passkeys"), "the Passkeys section says it cannot add one").toHaveLength(1);
  });
});

describe("the Account page's theme", () => {
  it("selects the System theme until another is picked", async () => {
    await accountOpened(NO_SET);

    const theme = await screen.findByRole("radiogroup", { name: "Theme" });
    const device = screen.getByRole("radio", { name: "System" });

    expect(theme.getAttribute("aria-describedby")).not.toBeNull();
    expect(device.getAttribute("aria-checked")).toBe("true");
  });

  it("applies a picked theme at once and saves it", async () => {
    await accountOpened(NO_SET);

    fireEvent.click(await screen.findByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(localStorage.getItem(THEME_KEPT_UNDER)).toBe("dark");
  });
});

describe("setting up an authenticator on the Account page", () => {
  it("uses the replace route after a restore code", async () => {
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

    expect(
      await screen.findByRole("img", { name: "QR code for your authenticator app" }),
    ).toBeDefined();
    expect(asked).toContain("/second-factor/replace/authenticator-start");
    expect(asked).not.toContain("/authenticator/start");
  });
});

describe("generating recovery codes on the Account page", () => {
  it("names the address the confirmation email goes to", async () => {
    vi.stubGlobal(
      "fetch",
      adasApi(
        () => ISSUED,
        () => NO_SET,
      ),
    );

    await pressGenerateCodes();

    await waitFor(() => {
      expect(saidOnThePage().join(" ")).toContain(SESSION.user.email);
    });
  });

  it("offers Replace when another tab already generated codes", async () => {
    vi.stubGlobal("fetch", anotherTabGeneratedCodes());

    await pressGenerateCodes();

    expect(await screen.findByRole("button", { name: "Replace Recovery Codes" })).toBeDefined();
    expect(signInAlertsWithWords(), "no alert says why Generate was refused").toHaveLength(1);
  });

  it("refuses with an alert until the restore code is entered", async () => {
    vi.stubGlobal(
      "fetch",
      adasApi(
        () => RESTORED,
        () => NO_SET,
      ),
    );

    await pressGenerateCodes();

    await waitFor(() => {
      expect(signInAlertsWithWords(), "no alert asks for the restore code").toHaveLength(1);
    });
  });
});

const NO_FACTOR_YET = {
  ...NOTHING_HELD,
  mustHoldOne: false,
  thisSession: sessionStanding("not-required"),
};

const AN_AUTHENTICATOR_AND_CODES = {
  ...NO_FACTOR_YET,
  authenticator: "set-up",
  recoveryCodes: { unused: CODES.length, madeAt: MADE_AT },
};

const A_SETUP_KEY = { setupAddress: "otpauth://totp/better-answers:ada?secret=JBSWY3DPEHPK3PXP" };

const readingAfter = (happened: () => boolean, before: unknown, after: unknown) => (): unknown =>
  happened() ? after : before;

const saidOnThePage = (): readonly string[] =>
  [...document.querySelectorAll('[role="status"]')]
    .map((status) => status.textContent)
    .filter((words) => words !== "");

const timesAsked = (asked: readonly string[], procedure: string): number =>
  asked.filter((address) => address === `/trpc/${procedure}`).length;

describe("finishing a first authenticator on the Account page", () => {
  it("pressing Set Up mid-finish still shows the new codes", async () => {
    const answer = Promise.withResolvers<void>();
    let finished = false;
    const asked = adasRoutes(
      readingAfter(() => finished, NO_FACTOR_YET, AN_AUTHENTICATOR_AND_CODES),
      new Map([
        ["/authenticator/start", answering(A_SETUP_KEY)],
        [
          "/authenticator/finish",
          async () => {
            await answer.promise;
            finished = true;
            return answered({ recoveryCodes: CODES, madeAt: MADE_AT });
          },
        ],
      ]),
    );
    await openAsAda("/account");
    const setUp = await screen.findByRole("button", { name: "Set Up an Authenticator" });
    fireEvent.click(setUp);
    expect(setUp.getAttribute("aria-expanded")).toBe("true");
    const field = await screen.findByRole("textbox", { name: "Authenticator Code" });

    fireEvent.change(field, { target: { value: "123456" } });

    await waitFor(() => {
      expect(asked).toContain("/authenticator/finish");
      expect(setUp.getAttribute("aria-disabled")).toBe("true");
    });
    act(() => {
      setUp.focus();
    });
    await userEvent.keyboard("{Enter}");
    expect(setUp.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Authenticator Code" })).toBeDefined();

    answer.resolve();

    const list = await screen.findByRole("list", { name: "Recovery Codes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(CODES.length);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Save Your Recovery Codes" }),
      );
    });
  });
});

describe("removing and replacing on the Account page", () => {
  it("a member removes their authenticator through its dialog", async () => {
    let removed = false;
    const asked = adasRoutes(
      readingAfter(() => removed, AN_AUTHENTICATOR_AND_CODES, NO_FACTOR_YET),
      new Map(),
      new Map([
        [
          "person.removeAuthenticator",
          () => {
            removed = true;
            return {};
          },
        ],
      ]),
    );
    await openAsAda("/account");
    const remove = await screen.findByRole("button", { name: "Remove" });
    expect(saidOnThePage()).toEqual([]);

    fireEvent.click(remove);

    const dialog = await screen.findByRole("dialog", {
      name: "Remove Authenticator",
      description: /\S/,
    });
    expect(timesAsked(asked, "person.removeAuthenticator")).toBe(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    const setUp = await screen.findByRole("button", { name: "Set Up an Authenticator" });
    expect(timesAsked(asked, "person.removeAuthenticator")).toBe(1);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(saidOnThePage()).toHaveLength(1);
    expect(saidOnThePage()[0]).toContain(SIGNED_IN_AS_ADA.person.email);
    await waitFor(() => {
      expect(document.activeElement).toBe(setUp);
    });
  });

  it("replacing the recovery codes shows a new set", async () => {
    const asked = adasRoutes(
      () => AN_AUTHENTICATOR_AND_CODES,
      new Map(),
      new Map([
        [
          "person.replaceRecoveryCodes",
          () => ({ recoveryCodes: CODES, madeAt: MADE_AT, replaced: true }),
        ],
      ]),
    );
    await openAsAda("/account");
    const replace = await screen.findByRole("button", { name: "Replace Recovery Codes" });
    expect(screen.queryByRole("list", { name: "Recovery Codes" })).toBeNull();

    fireEvent.click(replace);

    const dialog = await screen.findByRole("dialog", {
      name: "Replace Recovery Codes",
      description: /\S/,
    });
    expect(timesAsked(asked, "person.replaceRecoveryCodes")).toBe(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Replace" }));

    const list = await screen.findByRole("list", { name: "Recovery Codes" });
    expect(timesAsked(asked, "person.replaceRecoveryCodes")).toBe(1);
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((code) => code.textContent),
    ).toEqual(CODES);
    expect(
      paragraphsIn("Save Your Recovery Codes"),
      "a replaced set does not say the old codes stopped working",
    ).toHaveLength(2);
    expect(saidOnThePage()).toHaveLength(1);
    expect(saidOnThePage()[0]).toContain(SIGNED_IN_AS_ADA.person.email);
  });
});

const EDITOR = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: SIGNED_IN_AS_ADA.person.email },
  role: "Editor",
};

const inTheBand = () => within(screen.getByRole("banner"));

describe("the Account page of a member", () => {
  placedWithoutMeasuring();

  it("shows a member's Account page inside the shell", async () => {
    adasRoutes(() => NO_FACTOR_YET);
    const outside = await openAsAda("/account");
    await screen.findByRole("heading", { level: 1, name: "Account" });
    expect(screen.getByRole("link", { name: "Go to better-answers" })).toBeDefined();
    expect(screen.queryByRole("navigation", { name: "Areas" })).toBeNull();
    outside.rendered.unmount();

    adasRoutes(
      () => NO_FACTOR_YET,
      new Map(),
      new Map<string, () => unknown>([
        ["session.member", () => EDITOR],
        ["session.operator", () => ({ operator: false, name: "Ada" })],
      ]),
    );
    await openAsAda("/account");

    const rail = await screen.findByRole("navigation", { name: "Areas" });
    expect(within(rail).getAllByRole("link").length).toBeGreaterThan(0);
    const crumbs = inTheBand().getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Account" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Go to better-answers" })).toBeNull();

    fireEvent.keyDown(document.body, { key: "?" });
    const listed = await screen.findByRole("dialog", { name: "Keyboard Shortcuts on Account" });
    fireEvent.keyDown(listed, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Keyboard Shortcuts on Account" })).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keyboard Shortcuts" }));
  });
});
