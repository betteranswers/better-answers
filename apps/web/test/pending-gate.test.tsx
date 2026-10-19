import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { detourTo } from "@/features/auth/second-factor-steps.ts";
import {
  CONFIRM_WORDS,
  PROMOTION_WORDS,
  SETUP_WORDS,
  UNSAVED_AFTER_CONFIRMING,
} from "@/features/auth/second-factor-words.ts";
import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";
import { HOMES } from "@/shared/navigation.ts";

import { openApp } from "./open-app.tsx";
import {
  adasApi,
  answering,
  BOTH_HELD,
  loadedAsAda,
  NOTHING_HELD,
  openAsAda,
  PENDING,
  sessionStanding,
  withPasskeysHere,
  type Route,
} from "./second-factor-api.ts";
import { addressOf, answered } from "./stubbed-api.ts";

/**
 * The auth library keeps the `fetch` it found when made, so it is given one that asks whichever
 * stub stands now.
 */
vi.hoisted(() => {
  const original = globalThis.fetch;
  const forwarding: typeof fetch = (input, init) =>
    globalThis.fetch === forwarding ? original(input, init) : globalThis.fetch(input, init);
  globalThis.fetch = forwarding;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  globalThis.history.replaceState(null, "", "/");
});

const A_MEMBER = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
};

const WAITING_TO_CONFIRM = BOTH_HELD;

const CONFIRMED = { ...BOTH_HELD, thisSession: sessionStanding("confirmed", { confirmed: true }) };

const SHELL_READS = new Map<string, () => unknown>([
  ["session.member", () => A_MEMBER],
  ["session.operator", () => ({ operator: false, name: "Ada" })],
]);

const NO_SESSION = {
  error: {
    message: "no-session",
    code: -32_001,
    data: {
      code: "UNAUTHORIZED",
      httpStatus: 401,
      refusal: { word: "no-session", class: "unauthenticated" },
    },
  },
};

const NO_GROUPS = {
  error: {
    message: "forbidden",
    code: -32_003,
    data: {
      code: "FORBIDDEN",
      httpStatus: 403,
      refusal: { word: "forbidden", class: "forbidden" },
    },
  },
};

const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

const pendingAt = (held: unknown, procedures = new Map<string, () => unknown>()) =>
  adasApi(() => held, new Map(), procedures, PENDING);

describe("a pending session meeting the gate", () => {
  it("sends the shell's reader to confirm, keeping their address", async () => {
    pendingAt(WAITING_TO_CONFIRM);

    const { router } = await openAsAda("/people/members");

    expect(router.state.location.href).toBe("/confirm?redirect=%2Fpeople%2Fmembers");
    expect(heading()).toBe("Confirm It’s You");
  });

  it("sends a reader holding no factor to setup instead", async () => {
    pendingAt(NOTHING_HELD);

    const { router } = await loadedAsAda("/people/members");

    expect(router.state.location.href).toBe("/setup?redirect=%2Fpeople%2Fmembers");
  });

  it("sends the console's reader to confirm, though its standing answers", async () => {
    pendingAt(
      { ...WAITING_TO_CONFIRM, operator: true },
      new Map([["session.operator", () => ({ operator: true, name: "Ada" })]]),
    );

    const { router } = await loadedAsAda("/console/people/everyone");

    expect(router.state.location.href).toBe("/confirm?redirect=%2Fconsole%2Fpeople%2Feveryone");
  });

  it.each([
    ["/account", "/confirm?redirect=%2Faccount"],
    ["/no-workspace", "/confirm?redirect=%2Fno-workspace"],
    ["/choose-workspace", "/confirm?redirect=%2Fchoose-workspace"],
    ["/invitations/inv-1", "/confirm?redirect=%2Finvitations%2Finv-1"],
    ["/display-name?redirect=%2Fpeople", "/confirm?redirect=%2Fpeople"],
    ["/recovery-codes?redirect=%2Fpeople", "/confirm?redirect=%2Fpeople"],
  ])("detours %s to confirm before it draws", async (path, detour) => {
    pendingAt(WAITING_TO_CONFIRM);

    const { router } = await loadedAsAda(path);

    expect(router.state.location.href).toBe(detour);
  });

  it("keeps a signed connection's whole query through the detour", () => {
    const signed = "?client_id=claude&sig=abc&exp=1791000000";

    expect(detourTo("/confirm", { href: `/choose-workspace${signed}`, query: signed })).toBe(
      `/confirm${signed}`,
    );
  });

  it("draws the page for a session already confirmed", async () => {
    pendingAt(CONFIRMED);

    const { router } = await loadedAsAda("/no-workspace");

    expect(router.state.location.pathname).toBe("/no-workspace");
  });
});

describe("a pending refusal heard mid-session", () => {
  it("sends a refused read to confirm, keeping the address", async () => {
    pendingAt(WAITING_TO_CONFIRM, SHELL_READS);

    const { router } = await openAsAda("/people/groups");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Confirm It’s You" }),
    ).toBeDefined();
    expect(router.state.location.href).toBe("/confirm?redirect=%2Fpeople%2Fgroups");
  });

  it("sends a pending page's signed-out reader to sign-in, keeping redirect", async () => {
    vi.stubGlobal("fetch", answeringTheReadWith(NO_SESSION));

    const { router } = await openAsAda("/confirm?redirect=%2Fpeople%2Fmembers");

    await waitFor(() => {
      expect(router.state.location.href).toBe("/sign-in?redirect=%2Fpeople%2Fmembers");
    });
  });

  it("says on return that the refused change wasn't saved", async () => {
    withPasskeysHere();
    const ada = adaPromotedMidSession();
    vi.stubGlobal("fetch", ada.fetch);
    const router = await openInTheBrowser("/people/groups");

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss Passkey Offer" }));
    const field = await screen.findByRole("textbox", { name: "Authenticator Code" });
    expect(router.state.location.href).toBe("/confirm?redirect=%2Fpeople%2Fgroups");
    fireEvent.change(field, { target: { value: "123456" } });

    await waitFor(() => {
      const statuses = screen.getAllByRole("status").map((status) => status.textContent);
      expect(statuses).toContain(UNSAVED_AFTER_CONFIRMING);
    });
    expect(router.state.location.pathname).toBe("/people/groups");
  });
});

const answeringTheReadWith =
  (read: unknown) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) {
      return answered({ session: { id: "s" }, user: { id: "p", name: "Ada" } });
    }
    const names = pathname.replace("/trpc/", "").split(",");
    return answered(names.map((name) => (name === "person.secondFactor" ? read : PENDING)));
  };

const adaPromotedMidSession = () => {
  let pending = false;
  const held = () => ({
    ...BOTH_HELD,
    passkeys: [],
    thisSession: pending ? sessionStanding("confirm") : sessionStanding("confirmed"),
  });
  const routes = new Map<string, Route>([
    [
      "/second-factor/confirm/authenticator",
      () => {
        pending = false;
        return answering({ confirmed: true })();
      },
    ],
  ]);
  const answerTo = (name: string): unknown => {
    if (name === "person.secondFactor") return { result: { data: held() } };
    if (name === "person.dismissPasskeyOffer") pending = true;
    if (pending) return PENDING;
    const shell = SHELL_READS.get(name);
    return shell === undefined ? NO_GROUPS : { result: { data: shell() } };
  };
  return {
    fetch: (input: string | URL | Request): Promise<Response> => {
      const { pathname } = addressOf(input);
      if (!pathname.startsWith("/trpc/")) {
        return (
          routes.get(pathname)?.() ??
          answered({ session: { id: "s" }, user: { id: "p", name: "Ada" } })
        );
      }
      return answered(pathname.replace("/trpc/", "").split(",").map(answerTo));
    },
  };
};

const openInTheBrowser = async (path: string) => {
  globalThis.history.replaceState(null, "", path);
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  const router = createAppRouter(clients, createBrowserHistory());
  await router.load();
  render(
    <Providers clients={clients}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
};

describe("the steps after a sign-in", () => {
  const signedInByLink = (held: unknown) =>
    adasApi(
      () => held,
      new Map([
        [
          "/sign-in-link/describe",
          answering({ state: "bound", address: "ada@example.test", carried: "" }),
        ],
        [
          "/sign-in-link/sign-in",
          answering({ displayNameGiven: true, carried: "?redirect=%2Fpeople%2Fmembers" }),
        ],
      ]),
    );

  it.each([
    [
      "confirms before the unseen codes and the display name",
      { ...WAITING_TO_CONFIRM, codesAcknowledged: false },
      "/confirm?redirect=%2Fpeople%2Fmembers",
    ],
    [
      "sets up first when the session holds no factor",
      NOTHING_HELD,
      "/setup?redirect=%2Fpeople%2Fmembers",
    ],
  ])("%s", async (_title, held, step) => {
    signedInByLink(held);
    const { router } = await openAsAda("/sign-in/link#abc123");

    fireEvent.click(await screen.findByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(router.state.location.href).toBe(step);
    });
  });

  it("owes the passkey offer again after a sign-in by link", async () => {
    const shownUnder = "better-answers.passkey-offer-shown";
    globalThis.localStorage.setItem(shownUnder, "shown");
    signedInByLink(NOTHING_HELD);
    await openAsAda("/sign-in/link#abc123");

    fireEvent.click(await screen.findByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(globalThis.localStorage.getItem(shownUnder)).toBeNull();
    });
  });

  it.each([
    "//evil.example",
    "https://evil.example",
    String.raw`/\evil.example`,
    "evil.example/settings",
  ])("lands a redirect to %s on home", async (redirect) => {
    adasApi(() => CONFIRMED, new Map(), SHELL_READS);

    const { router } = await openAsAda(`/confirm?redirect=${encodeURIComponent(redirect)}`);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(HOMES.Admin.path);
    });
  });
});

describe("the confirm page for a person just promoted", () => {
  it("lists what can confirm their sign-in, before the ways", async () => {
    adasApi(() => ({ ...WAITING_TO_CONFIRM, promoted: true }));

    await openAsAda("/confirm");

    const list = await screen.findByRole("list", { name: PROMOTION_WORDS.lead });
    const [passkey, ...others] = [...list.querySelectorAll("li")].map((item) => item.textContent);
    expect(passkey).toMatch(/MacBook.*3 March 2026/v);
    expect(others).toEqual(["Authenticator"]);
    expect(screen.getByText(PROMOTION_WORDS.after)).toBeDefined();
    const code = screen.getByRole("textbox", { name: "Authenticator Code" });
    expect(list.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists nothing once the promotion has been confirmed", async () => {
    adasApi(() => WAITING_TO_CONFIRM);

    await openAsAda("/confirm");

    await screen.findByRole("textbox", { name: "Authenticator Code" });
    expect(screen.queryByText(PROMOTION_WORDS.lead)).toBeNull();
    expect(screen.queryByText(PROMOTION_WORDS.after)).toBeNull();
  });

  it("names better-answers support as the operator's reason", async () => {
    adasApi(() => ({ ...WAITING_TO_CONFIRM, operator: true }));

    await openAsAda("/confirm");

    expect(await screen.findByText(CONFIRM_WORDS.whyTheOperator)).toBeDefined();
  });

  it("names the workspace on setup that just made them Admin", async () => {
    adasApi(() => ({
      ...NOTHING_HELD,
      promoted: true,
      thisSession: sessionStanding("setup", { adminOf: "Northern Tooling" }),
    }));

    await openAsAda("/setup");

    const why = await screen.findByText(SETUP_WORDS.nowAnAdmin("Northern Tooling"), {
      exact: false,
    });
    expect(why.textContent).toContain("Northern Tooling");
  });
});

describe("a sign-in that ended while waiting on its second factor", () => {
  it("is remembered as pending by the page that waited", async () => {
    adasApi(() => WAITING_TO_CONFIRM);

    await openAsAda("/confirm");
    await screen.findByRole("textbox", { name: "Authenticator Code" });

    expect(globalThis.localStorage.getItem("better-answers.session")).toBe("pending");
  });

  it("is remembered as held once the shell reads the session", async () => {
    globalThis.localStorage.setItem("better-answers.session", "pending");
    adasApi(() => CONFIRMED, new Map(), SHELL_READS);

    await openAsAda("/people/members");

    expect(globalThis.localStorage.getItem("better-answers.session")).toBe("held");
  });

  it("is remembered as held once the step after setup reads", async () => {
    globalThis.localStorage.setItem("better-answers.session", "pending");
    adasApi(() => CONFIRMED);

    await loadedAsAda("/display-name?redirect=%2Fpeople");

    expect(globalThis.localStorage.getItem("better-answers.session")).toBe("held");
  });

  it("says on sign-in that it ended unconfirmed within the hour", async () => {
    globalThis.localStorage.setItem("better-answers.session", "pending");
    vi.stubGlobal("fetch", () => answered(null));

    await openApp("/sign-in?redirect=%2Fpeople%2Fmembers");

    expect(await screen.findByText(SIGN_IN_WORDS.arrived["confirm-timed-out"])).toBeDefined();
  });
});
