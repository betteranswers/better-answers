import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppClients, type AppClients } from "@/app/providers.tsx";

import { openApp } from "./open-app.tsx";

const A_MEMBERSHIP = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
};

const NO_SESSION = "no-session";

const NEEDS_A_PICK = "no-active-workspace";

const REFUSED_CODE = -32_001;

const A_SESSION = { session: { activeOrganizationId: "w" }, user: { id: "p" } };

const TWO_WORKSPACES = [
  { id: "w", name: "Northern Tooling" },
  { id: "x", name: "Southern Castings" },
];

let asked: string[] = [];

const addressOf = (input: string | URL | Request): URL =>
  new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    "http://app.test",
  );

const answered = (body: unknown): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

// The api answers a batch as one array with an entry per procedure, a refusal being an entry.
const answering =
  (refusal?: string) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) {
      return answered(pathname === "/organization/list" ? TWO_WORKSPACES : A_SESSION);
    }

    const names = pathname.replace("/trpc/", "").split(",");
    asked.push(...names);
    return answered(
      names.map((name) =>
        refusal === undefined
          ? { result: { data: A_MEMBERSHIP } }
          : {
              error: {
                message: refusal,
                code: REFUSED_CODE,
                data: {
                  code: "UNAUTHORIZED",
                  httpStatus: 401,
                  path: name,
                  refusal: { word: refusal, class: "unauthenticated" },
                },
              },
            },
      ),
    );
  };

const membershipAsks = () => asked.filter((name) => name === "session.membership").length;

const openAt = async (path: string, clients?: AppClients) => (await openApp(path, clients)).router;

const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

beforeEach(() => {
  asked = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a person the api will not answer about", () => {
  it("meets the sign-in screen, which is told the address they were asking for", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const router = await openAt("/people/roles");

    expect(heading()).toBe("Sign in");
    expect(router.state.location.href).toBe("/sign-in?redirect=%2Fpeople%2Froles");
  });

  it("meets the picker instead when the session names no workspace", async () => {
    vi.stubGlobal("fetch", answering(NEEDS_A_PICK));

    const router = await openAt("/people/roles");

    expect(screen.getByText("Reading your workspaces.")).toBeDefined();
    expect(router.state.location.href).toBe("/choose-workspace");
  });

  it("is left on the sign-in screen when that is where they went", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const router = await openAt("/sign-in");

    expect(heading()).toBe("Sign in");
    expect(router.state.location.href).toBe("/sign-in");
  });

  it("is carried into the shell when the read failed for any other reason", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("the network is down")));
    const clients = createAppClients();
    // The shell's own read is batched and retried past the end of this test, onto the next stub.
    clients.queryClient.setDefaultOptions({ queries: { retry: false } });

    const router = await openAt("/people/roles", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    expect(heading()).toBe("People");
    expect(screen.getByRole("navigation", { name: "Control Centre" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/people/roles");
  });
});

describe("the membership the shell and its redirect both read", () => {
  it("is one read, so drawing the shell and moving between views asks the api nothing more", async () => {
    vi.stubGlobal("fetch", answering());
    const router = await openAt("/people/roles");
    await screen.findByText("Northern Tooling", { exact: false });
    expect(membershipAsks()).toBe(1);

    await router.navigate({ href: "/people/owners" });

    expect(router.state.location.pathname).toBe("/people/owners");
    expect(membershipAsks()).toBe(1);
  });
});
