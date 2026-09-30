import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppClients } from "@/app/providers.tsx";
import { FAILED_SCREEN, RAIL, UNKNOWN_SCREEN } from "@/app/words.ts";
import { PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { ROLES } from "@/features/people/role-meanings.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";

import { appAt, openApp } from "./open-app.tsx";
import { addressOf, answered, withTheApiDown } from "./stubbed-api.ts";

const A_MEMBERSHIP = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
};

const NO_SESSION = "no-session";

const NEEDS_A_PICK = "no-active-workspace";

const REFUSED_CODE = -32_001;

const A_SESSION = { session: { activeOrganizationId: "w" }, user: { id: "p", name: "Ada" } };

const TWO_WORKSPACES = [
  { id: "w", name: "Northern Tooling" },
  { id: "x", name: "Southern Castings" },
];

let asked: string[] = [];

/** The api answers a batch as one array with an entry per procedure, a refusal being an entry. */
const answering =
  (refusal?: string, role: Role = "Admin") =>
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
          ? { result: { data: { ...A_MEMBERSHIP, role } } }
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
  it("meets sign-in, which is told the address they asked for", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const router = await openAt("/people/groups");

    expect(heading()).toBe("Sign in");
    expect(router.state.location.href).toBe("/sign-in?redirect=%2Fpeople%2Fgroups");
  });

  it("meets the picker instead when the session names no workspace", async () => {
    vi.stubGlobal("fetch", answering(NEEDS_A_PICK));

    const router = await openAt("/people/groups");

    expect(screen.getByText(PICKER_WORDS.reading)).toBeDefined();
    expect(router.state.location.href).toBe("/choose-workspace");
  });

  it("stays on the sign-in screen when they went there", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const router = await openAt("/sign-in");

    expect(heading()).toBe("Sign in");
    expect(router.state.location.href).toBe("/sign-in");
  });

  it("reaches the shell and the screen's state when unread", async () => {
    const clients = withTheApiDown();

    const router = await openAt("/people/members", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    expect(heading()).toBe("People");
    expect(heading()).not.toBe(UNKNOWN_SCREEN.heading);
    expect(screen.getByRole("navigation", { name: RAIL })).toBeDefined();
    expect(router.state.location.pathname).toBe("/people/members");
  });
});

describe("the membership the shell and its redirect both read", () => {
  it("is read once across drawing the shell and changing screens", async () => {
    vi.stubGlobal("fetch", answering());
    const router = await openAt("/people/members");
    await screen.findByText("Northern Tooling", { exact: false });
    expect(membershipAsks()).toBe(1);

    await router.navigate({ href: "/people/groups" });

    expect(router.state.location.pathname).toBe("/people/groups");
    expect(membershipAsks()).toBe(1);
  });
});

describe("the index route", () => {
  for (const role of ROLES) {
    const home = HOMES[role];

    it(`lands a member at ${role} on ${home.name}`, async () => {
      vi.stubGlobal("fetch", answering(undefined, role));

      const { router } = await appAt("/");

      expect(router.state.location.pathname).toBe(home.path);
    });
  }

  it("shows the failed read, not Ask, holding no role", async () => {
    const clients = withTheApiDown();

    const router = await openAt("/", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    expect(heading()).toBe(FAILED_SCREEN.heading);
    expect(router.state.location.pathname).toBe("/");
  });

  it("sends the person home once asking again reads their role", async () => {
    const clients = withTheApiDown();
    const router = await openAt("/", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    vi.stubGlobal("fetch", answering(undefined, "Viewer"));
    fireEvent.click(screen.getByRole("button", { name: FAILED_SCREEN.retry }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Viewer.path));
  });
});
