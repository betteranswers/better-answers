import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppClients } from "@/app/providers.tsx";
import { nextAfterSignIn } from "@/features/auth/carried-flow.ts";
import { stepAfterTheCodes } from "@/features/auth/second-factor-steps.ts";
import { NO_WORKSPACE_HEADING, PICKER_WORDS } from "@/features/auth/workspace/workspace-words.ts";
import { ROLES } from "@/features/people/role-meanings.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";
import { appAt, openApp } from "@test/open-app.tsx";
import { addressOf, answered, answeringAs, withTheApiDown } from "@test/stubbed-api.ts";

await vi.hoisted(() => import("@test/forwarding-fetch.ts"));

const A_MEMBER = {
  workspace: { id: "w", name: "Northern Tooling" },
  person: { id: "p", name: "Ada", email: "ada@example.test" },
  role: "Admin",
};

const NO_SESSION = "no-session";

const NEEDS_A_PICK = "no-active-workspace";

const REFUSED_CODE = -32_001;

const A_SESSION = { session: { activeOrganizationId: "w" }, user: { id: "p", name: "Ada" } };

const WORKSPACES_READ = "person.workspaces";

const TWO_WORKSPACES = [
  { workspace: { id: "w", name: "Northern Tooling" }, role: "Admin" },
  { workspace: { id: "x", name: "Southern Castings" }, role: "Viewer" },
];

let requested: string[] = [];

const answerTo = (name: string, refusal: string | undefined, role: Role) => {
  if (name === WORKSPACES_READ) return { result: { data: TWO_WORKSPACES } };
  if (refusal === undefined) return { result: { data: { ...A_MEMBER, role } } };
  return {
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
  };
};

const answering =
  (refusal?: string, role: Role = "Admin") =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(A_SESSION);

    const names = pathname.replace("/trpc/", "").split(",");
    requested.push(...names);
    return answered(names.map((name) => answerTo(name, refusal, role)));
  };

const SIGNED_IN_WITH_NONE_OPEN = {
  session: { id: "s" },
  user: { id: "p", name: "Ada", email: "ada@example.test" },
};

const EMPTY_READS = new Set(["person.workspaces", "person.invitations", "console.workspaces.list"]);

const apiWithNoWorkspace =
  (operator: boolean) =>
  (input: string | URL | Request): Promise<Response> => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(SIGNED_IN_WITH_NONE_OPEN);

    const answerToNoWorkspace = (name: string) => {
      if (name === "session.operator") return { result: { data: { operator, name: "Ada" } } };
      if (EMPTY_READS.has(name)) return { result: { data: [] } };
      return answerTo(name, NEEDS_A_PICK, "Admin");
    };
    return answered(pathname.replace("/trpc/", "").split(",").map(answerToNoWorkspace));
  };

const droppingFirstMemberRead = (role: Role) => {
  const answer = answeringAs(role);
  let dropped = false;
  return (input: string | URL | Request): Promise<Response> => {
    if (dropped || !addressOf(input).pathname.includes("session.member")) return answer(input);
    dropped = true;
    return Promise.reject(new TypeError("the request was dropped"));
  };
};

const ACCESS_ALLOWED = { hidden: false, unread: false };

const INVITE = "Invite a Person";

const memberRequestCount = () => requested.filter((name) => name === "session.member").length;

const openAt = async (path: string, clients?: AppClients) => (await openApp(path, clients)).router;

const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

const roleDescriptionOf = (button: HTMLElement) =>
  document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent;

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a person whose member read fails", () => {
  it("is sent to sign-in with the address they requested", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const router = await openAt("/people/groups");

    expect(heading()).toBe("Sign In");
    expect(router.state.location.href).toBe("/sign-in?redirect=%2Fpeople%2Fgroups");
  });

  it("is sent to the workspace picker when none is active", async () => {
    vi.stubGlobal("fetch", answering(NEEDS_A_PICK));

    const router = await openAt("/people/groups");

    expect(screen.getByText(PICKER_WORDS.reading)).toBeDefined();
    expect(router.state.location.href).toBe("/choose-workspace");
  });

  it("sees their role beside each workspace on the picker", async () => {
    vi.stubGlobal("fetch", answering(NEEDS_A_PICK));

    await openAt("/choose-workspace");
    const northern = await screen.findByRole("button", { name: "Northern Tooling" });

    expect(roleDescriptionOf(northern)).toBe("Admin");
    expect(roleDescriptionOf(screen.getByRole("button", { name: "Southern Castings" }))).toBe(
      "Viewer",
    );
  });

  it("stays on the sign-in page when they open it", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const router = await openAt("/sign-in");

    expect(heading()).toBe("Sign In");
    expect(router.state.location.href).toBe("/sign-in");
  });

  it("sees the shell and requested page with the api down", async () => {
    const clients = withTheApiDown();

    const router = await openAt("/people/members", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    expect(heading()).toBe("Members");
    expect(heading()).not.toBe("Page Not Found");
    expect(screen.getByRole("navigation", { name: "Areas" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/people/members");
  });

  it("hides a forbidden page once a late role read arrives", async () => {
    vi.stubGlobal("fetch", droppingFirstMemberRead("Viewer"));

    await openAt("/people/members");
    await within(screen.getByRole("navigation", { name: "Areas" })).findByRole("link", {
      name: "Ask",
    });

    expect(heading()).toBe("Page Not Found");
    expect(screen.getByRole("link", { name: "Go to New Question" })).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: INVITE })).toBeNull();
  });

  it("keeps the page access decided when the role first arrives", async () => {
    vi.stubGlobal("fetch", droppingFirstMemberRead("Admin"));
    const { router, clients } = await openApp("/people/members");
    const rail = () => within(screen.getByRole("navigation", { name: "Areas" }));
    await rail().findByRole("link", { name: "Control Centre" });
    await vi.waitFor(() =>
      expect(router.state.matches.at(-1)?.context).toMatchObject(ACCESS_ALLOWED),
    );
    expect(await screen.findByRole("button", { name: INVITE })).toBeDefined();

    vi.stubGlobal("fetch", answeringAs("Viewer"));
    await clients.queryClient.refetchQueries({ queryKey: [["session", "member"]] });
    await rail().findByRole("link", { name: "Ask" });

    expect(heading()).toBe("Members");
    expect(screen.getByRole("tablist")).toBeDefined();
  });
});

describe("the member read shared by the shell and redirects", () => {
  it("is fetched once across rendering the shell and navigating", async () => {
    vi.stubGlobal("fetch", answering());
    const router = await openAt("/people/members");
    await screen.findByText("Northern Tooling", { exact: false });
    expect(memberRequestCount()).toBe(1);

    await router.navigate({ href: "/people/groups" });

    expect(router.state.location.pathname).toBe("/people/groups");
    expect(memberRequestCount()).toBe(1);
  });
});

describe("the index route", () => {
  for (const role of ROLES) {
    const home = HOMES[role];

    it(`sends a member with role ${role} to ${home.name}`, async () => {
      vi.stubGlobal("fetch", answering(undefined, role));

      const { router } = await appAt("/");

      expect(router.state.location.pathname).toBe(home.path);
    });
  }

  it("shows the load failure, not Ask, without a role", async () => {
    const clients = withTheApiDown();

    const router = await openAt("/", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    expect(heading()).toBe("This Page Didn’t Load");
    expect(router.state.location.pathname).toBe("/");
  });

  it("sends the person home once Try Again reads their role", async () => {
    const clients = withTheApiDown();
    const router = await openAt("/", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    vi.stubGlobal("fetch", answering(undefined, "Viewer"));
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Viewer.path));
  });
});

type Router = Awaited<ReturnType<typeof openApp>>["router"];

const consoleLanding = async (router: Router) => {
  await screen.findByRole("heading", { level: 1, name: "Every Workspace" });
  return {
    at: router.state.location.pathname,
    inTheConsole:
      within(screen.getByRole("banner")).queryByRole("button", { name: "Console" }) !== null,
    showsNoWorkspace:
      screen.queryByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING }) !== null,
  };
};

const ON_THE_CONSOLE = { at: HOMES.operator.path, inTheConsole: true, showsNoWorkspace: false };

describe("a person in no workspace", () => {
  it("sends a no-workspace operator to the console after setup", async () => {
    vi.stubGlobal("fetch", apiWithNoWorkspace(true));

    const { router } = await openApp(stepAfterTheCodes(""));

    expect(await consoleLanding(router)).toEqual(ON_THE_CONSOLE);
  });

  it("sends no-workspace operators to the console at sign-in and /", async () => {
    vi.stubGlobal("fetch", apiWithNoWorkspace(true));
    expect(nextAfterSignIn("")).toBe("/");

    const { router } = await openApp("/");

    expect(await consoleLanding(router)).toEqual(ON_THE_CONSOLE);
  });

  it("shows a non-operator the no-workspace page", async () => {
    vi.stubGlobal("fetch", apiWithNoWorkspace(false));

    const { router } = await openApp("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING }),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe("/no-workspace");
  });

  it("renders an unknown address outside the shell", async () => {
    vi.stubGlobal("fetch", apiWithNoWorkspace(false));

    await openApp("/nothing-here");

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Page Not Found");
    const banner = within(screen.getByRole("banner"));
    expect(banner.getAllByText("better-answers").length).toBeGreaterThan(0);
    expect(banner.queryAllByRole("link")).toEqual([]);
    expect(banner.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByRole("navigation", { name: "Areas" })).toBeNull();
    expect(
      within(screen.getByRole("main"))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Go to Your Home Page"]);
  });
});
