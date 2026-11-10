import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { UNKNOWN_PAGE } from "@/app/words.ts";
import { AUTHENTICATOR_WORDS, PASSKEY_WORDS } from "@/features/auth/account-words.ts";
import { detourTo } from "@/features/auth/second-factor-steps.ts";
import { CONFIRM_WORDS } from "@/features/auth/second-factor/second-factor-words.ts";
import { HOMES } from "@/shared/navigation.ts";
import { openApp } from "@test/open-app.tsx";
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
} from "@test/second-factor-api.ts";
import { addressOf, answered } from "@test/stubbed-api.ts";

await vi.hoisted(() => import("@test/forwarding-fetch.ts"));

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

describe("a session waiting on its second factor", () => {
  it("sends a member to confirm, keeping the page address", async () => {
    pendingAt(WAITING_TO_CONFIRM);

    const { router } = await openAsAda("/people/members");

    expect(router.state.location.href).toBe("/confirm?redirect=%2Fpeople%2Fmembers");
    expect(heading()).toBe(CONFIRM_WORDS.heading);
  });

  it("sends a person with no second factor to setup", async () => {
    pendingAt(NOTHING_HELD);

    const { router } = await loadedAsAda("/people/members");

    expect(router.state.location.href).toBe("/setup?redirect=%2Fpeople%2Fmembers");
  });

  it("sends the operator to confirm before the console", async () => {
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
  ])("sends %s to confirm before showing it", async (path, detour) => {
    pendingAt(WAITING_TO_CONFIRM);

    const { router } = await loadedAsAda(path);

    expect(router.state.location.href).toBe(detour);
  });

  it("keeps a signed connection's full query when sent to confirm", () => {
    const signed = "?client_id=claude&sig=abc&exp=1791000000";

    expect(detourTo("/confirm", { href: `/choose-workspace${signed}`, query: signed })).toBe(
      `/confirm${signed}`,
    );
  });

  it("shows the page for a session already confirmed", async () => {
    pendingAt(CONFIRMED);

    const { router } = await loadedAsAda("/no-workspace");

    expect(router.state.location.pathname).toBe("/no-workspace");
  });
});

describe("the api asking for confirmation mid-session", () => {
  it("a refused read sends the person to confirm", async () => {
    pendingAt(WAITING_TO_CONFIRM, SHELL_READS);

    const { router } = await openAsAda("/people/groups");

    expect(
      await screen.findByRole("heading", { level: 1, name: CONFIRM_WORDS.heading }),
    ).toBeDefined();
    expect(router.state.location.href).toBe("/confirm?redirect=%2Fpeople%2Fgroups");
  });

  it("sends a signed-out person from confirm to sign-in", async () => {
    vi.stubGlobal("fetch", answeringTheReadWith(NO_SESSION));

    const { router } = await openAsAda("/confirm?redirect=%2Fpeople%2Fmembers");

    await waitFor(() => {
      expect(router.state.location.href).toBe("/sign-in?redirect=%2Fpeople%2Fmembers");
    });
  });

  it("says the refused change was not saved after confirming", async () => {
    withPasskeysHere();
    const ada = adaPromotedMidSession();
    vi.stubGlobal("fetch", ada.fetch);
    const router = await openInTheBrowser("/people/groups");

    fireEvent.click(await screen.findByRole("button", { name: PASSKEY_WORDS.dismissOffer }));
    const field = await screen.findByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });
    expect(router.state.location.href).toBe("/confirm?redirect=%2Fpeople%2Fgroups");
    fireEvent.change(field, { target: { value: "123456" } });

    await waitFor(() => {
      const inTheBand = within(screen.getByRole("banner")).getAllByRole("status");
      expect(inTheBand.map((status) => status.textContent).join("")).toMatch(/\S/u);
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
      "confirms before unacknowledged codes and the display name",
      { ...WAITING_TO_CONFIRM, codesAcknowledged: false },
      "/confirm?redirect=%2Fpeople%2Fmembers",
    ],
    [
      "sets up a second factor first when there is none",
      NOTHING_HELD,
      "/setup?redirect=%2Fpeople%2Fmembers",
    ],
  ])("%s", async (_title, held, step) => {
    signedInByLink(held);
    const { router } = await openAsAda("/sign-in/link#abc123");

    fireEvent.click(await screen.findByRole("button", { name: UNKNOWN_PAGE.signIn }));

    await waitFor(() => {
      expect(router.state.location.href).toBe(step);
    });
  });

  it("shows the passkey offer again after a link sign-in", async () => {
    const shownUnder = "better-answers.passkey-offer-shown";
    globalThis.localStorage.setItem(shownUnder, "shown");
    signedInByLink(NOTHING_HELD);
    await openAsAda("/sign-in/link#abc123");

    fireEvent.click(await screen.findByRole("button", { name: UNKNOWN_PAGE.signIn }));

    await waitFor(() => {
      expect(globalThis.localStorage.getItem(shownUnder)).toBeNull();
    });
  });

  it.each([
    "//evil.example",
    "https://evil.example",
    String.raw`/\evil.example`,
    "/\t/evil.example",
    "evil.example/settings",
  ])("sends a redirect to %s home instead", async (redirect) => {
    adasApi(() => CONFIRMED, new Map(), SHELL_READS);

    const { router } = await openAsAda(`/confirm?redirect=${encodeURIComponent(redirect)}`);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(HOMES.Admin.path);
    });
  });
});

describe("the confirm page for a person just promoted", () => {
  it("lists their second factors above the ways to confirm", async () => {
    adasApi(() => ({ ...WAITING_TO_CONFIRM, promoted: true }));

    await openAsAda("/confirm");

    const list = await screen.findByRole("list", { name: /\S/u });
    const [passkey, ...others] = [...list.querySelectorAll("li")].map((item) => item.textContent);
    expect(passkey).toMatch(/MacBook.*3 March 2026/v);
    expect(others).toEqual(["Authenticator"]);
    expect(list.nextElementSibling?.textContent, "no advice follows the list").toMatch(/\S/u);
    const code = screen.getByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });
    expect(list.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists no factors once the promotion is confirmed", async () => {
    adasApi(() => WAITING_TO_CONFIRM);

    await openAsAda("/confirm");

    await screen.findByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });
    expect(screen.queryByRole("list", { name: /\S/u })).toBeNull();
  });

  it("tells the operator why better-answers support must confirm", async () => {
    adasApi(() => ({ ...WAITING_TO_CONFIRM, operator: true }));

    await openAsAda("/confirm");

    await screen.findByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });
    expect(screen.getByRole("main").textContent).toContain("better-answers support");
  });

  it("names the workspace that made them an Admin on setup", async () => {
    adasApi(() => ({
      ...NOTHING_HELD,
      promoted: true,
      thisSession: sessionStanding("setup", { adminOf: "Northern Tooling" }),
    }));

    await openAsAda("/setup");

    await waitFor(() => {
      expect(screen.getByRole("main").textContent).toContain("Northern Tooling");
    });
  });
});

describe("a sign-in that expired before its second factor", () => {
  it("is stored as pending while the confirm page waits", async () => {
    adasApi(() => WAITING_TO_CONFIRM);

    await openAsAda("/confirm");
    await screen.findByRole("textbox", { name: AUTHENTICATOR_WORDS.codeField });

    expect(globalThis.localStorage.getItem("better-answers.session")).toBe("pending");
  });

  it("is stored as held once the shell reads the session", async () => {
    globalThis.localStorage.setItem("better-answers.session", "pending");
    adasApi(() => CONFIRMED, new Map(), SHELL_READS);

    await openAsAda("/people/members");

    expect(globalThis.localStorage.getItem("better-answers.session")).toBe("held");
  });

  it("is stored as held once the display-name step loads", async () => {
    globalThis.localStorage.setItem("better-answers.session", "pending");
    adasApi(() => CONFIRMED);

    await loadedAsAda("/display-name?redirect=%2Fpeople");

    expect(globalThis.localStorage.getItem("better-answers.session")).toBe("held");
  });

  it("explains the expiry on the sign-in page", async () => {
    globalThis.localStorage.setItem("better-answers.session", "pending");
    vi.stubGlobal("fetch", () => answered(null));

    await openApp("/sign-in?redirect=%2Fpeople%2Fmembers");

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/\S/u);
    });
  });
});
