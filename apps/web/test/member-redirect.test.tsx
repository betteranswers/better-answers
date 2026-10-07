import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppClients } from "@/app/providers.tsx";
import { FAILED_PAGE, goHome, RAIL, UNKNOWN_PAGE } from "@/app/words.ts";
import { PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { ROLES } from "@/features/people/role-meanings.ts";
import { CONTROL_CENTRE, HOMES, INVITE_A_PERSON, type Role } from "@/shared/navigation.ts";

import { appAt, openApp } from "./open-app.tsx";
import { addressOf, answered, answeringAs, withTheApiDown } from "./stubbed-api.ts";

const A_MEMBER = {
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
          ? { result: { data: { ...A_MEMBER, role } } }
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

/** The shell's one member read is dropped; the frame's read after it answers. */
const losingTheShellsRead = (role: Role) => {
  const answer = answeringAs(role);
  let lost = false;
  return (input: string | URL | Request): Promise<Response> => {
    if (lost || !addressOf(input).pathname.includes("session.member")) return answer(input);
    lost = true;
    return Promise.reject(new TypeError("the request was dropped"));
  };
};

/** What a page's `beforeLoad` finds once the role is in hand and lets the reader see it. */
const TAKEN = { hidden: false, unread: false };

const memberAsks = () => asked.filter((name) => name === "session.member").length;

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

  it("stays on the sign-in page when they went there", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const router = await openAt("/sign-in");

    expect(heading()).toBe("Sign in");
    expect(router.state.location.href).toBe("/sign-in");
  });

  it("reaches the shell and the page's state when unread", async () => {
    const clients = withTheApiDown();

    const router = await openAt("/people/members", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    expect(heading()).toBe("People");
    expect(heading()).not.toBe(UNKNOWN_PAGE.heading);
    expect(screen.getByRole("navigation", { name: RAIL })).toBeDefined();
    expect(router.state.location.pathname).toBe("/people/members");
  });

  it("hides a page from a role read only after arriving", async () => {
    vi.stubGlobal("fetch", losingTheShellsRead("Viewer"));

    await openAt("/people/members");
    await within(screen.getByRole("navigation", { name: RAIL })).findByRole("link", {
      name: HOMES.Viewer.name,
    });

    expect(heading()).toBe(UNKNOWN_PAGE.heading);
    expect(screen.getByRole("link", { name: goHome(HOMES.Viewer) })).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: INVITE_A_PERSON.name })).toBeNull();
  });

  it("holds the verdict taken when the role arrives", async () => {
    vi.stubGlobal("fetch", losingTheShellsRead("Admin"));
    const { router, clients } = await openApp("/people/members");
    const rail = () => within(screen.getByRole("navigation", { name: RAIL }));
    await rail().findByRole("link", { name: CONTROL_CENTRE.name });
    await vi.waitFor(() => expect(router.state.matches.at(-1)?.context).toMatchObject(TAKEN));

    // An Admin who demotes themself reads their role again, as a Viewer.
    vi.stubGlobal("fetch", answeringAs("Viewer"));
    await clients.queryClient.refetchQueries({ queryKey: [["session", "member"]] });
    await rail().findByRole("link", { name: HOMES.Viewer.name });

    expect(heading()).toBe("People");
    expect(screen.getByRole("tablist")).toBeDefined();
  });
});

describe("the member the shell and its redirect both read", () => {
  it("is read once across drawing the shell and changing pages", async () => {
    vi.stubGlobal("fetch", answering());
    const router = await openAt("/people/members");
    await screen.findByText("Northern Tooling", { exact: false });
    expect(memberAsks()).toBe(1);

    await router.navigate({ href: "/people/groups" });

    expect(router.state.location.pathname).toBe("/people/groups");
    expect(memberAsks()).toBe(1);
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

    expect(heading()).toBe(FAILED_PAGE.heading);
    expect(router.state.location.pathname).toBe("/");
  });

  it("sends the person home once asking again reads their role", async () => {
    const clients = withTheApiDown();
    const router = await openAt("/", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    vi.stubGlobal("fetch", answering(undefined, "Viewer"));
    fireEvent.click(screen.getByRole("button", { name: FAILED_PAGE.retry }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Viewer.path));
  });
});
