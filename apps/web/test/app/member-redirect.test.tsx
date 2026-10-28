import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppClients } from "@/app/providers.tsx";
import { PICKER_WORDS } from "@/features/auth/workspace/workspace-words.ts";
import { ROLES } from "@/features/people/role-meanings.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";
import { appAt, openApp } from "@test/open-app.tsx";
import { addressOf, answered, answeringAs, withTheApiDown } from "@test/stubbed-api.ts";

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

let asked: string[] = [];

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
    asked.push(...names);
    return answered(names.map((name) => answerTo(name, refusal, role)));
  };

const losingTheShellsRead = (role: Role) => {
  const answer = answeringAs(role);
  let lost = false;
  return (input: string | URL | Request): Promise<Response> => {
    if (lost || !addressOf(input).pathname.includes("session.member")) return answer(input);
    lost = true;
    return Promise.reject(new TypeError("the request was dropped"));
  };
};

const TAKEN = { hidden: false, unread: false };

const INVITE = "Invite a Person";

const memberAsks = () => asked.filter((name) => name === "session.member").length;

const openAt = async (path: string, clients?: AppClients) => (await openApp(path, clients)).router;

const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

const roleBeside = (button: HTMLElement) =>
  document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent;

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

    expect(heading()).toBe("Sign In");
    expect(router.state.location.href).toBe("/sign-in?redirect=%2Fpeople%2Fgroups");
  });

  it("meets the picker instead when the session names no workspace", async () => {
    vi.stubGlobal("fetch", answering(NEEDS_A_PICK));

    const router = await openAt("/people/groups");

    expect(screen.getByText(PICKER_WORDS.reading)).toBeDefined();
    expect(router.state.location.href).toBe("/choose-workspace");
  });

  it("reads their role beside each workspace on the picker", async () => {
    vi.stubGlobal("fetch", answering(NEEDS_A_PICK));

    await openAt("/choose-workspace");
    const northern = await screen.findByRole("button", { name: "Northern Tooling" });

    expect(roleBeside(northern)).toBe("Admin");
    expect(roleBeside(screen.getByRole("button", { name: "Southern Castings" }))).toBe("Viewer");
  });

  it("stays on the sign-in page when they went there", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const router = await openAt("/sign-in");

    expect(heading()).toBe("Sign In");
    expect(router.state.location.href).toBe("/sign-in");
  });

  it("reaches the shell and the page's state when unread", async () => {
    const clients = withTheApiDown();

    const router = await openAt("/people/members", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    expect(heading()).toBe("People");
    expect(heading()).not.toBe("Page Not Found");
    expect(screen.getByRole("navigation", { name: "Areas" })).toBeDefined();
    expect(router.state.location.pathname).toBe("/people/members");
  });

  it("hides a page from a role read only after arriving", async () => {
    vi.stubGlobal("fetch", losingTheShellsRead("Viewer"));

    await openAt("/people/members");
    await within(screen.getByRole("navigation", { name: "Areas" })).findByRole("link", {
      name: "Ask",
    });

    expect(heading()).toBe("Page Not Found");
    expect(screen.getByRole("link", { name: "Go to New Question" })).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: INVITE })).toBeNull();
  });

  it("holds the verdict taken when the role arrives", async () => {
    vi.stubGlobal("fetch", losingTheShellsRead("Admin"));
    const { router, clients } = await openApp("/people/members");
    const rail = () => within(screen.getByRole("navigation", { name: "Areas" }));
    await rail().findByRole("link", { name: "Control Centre" });
    await vi.waitFor(() => expect(router.state.matches.at(-1)?.context).toMatchObject(TAKEN));
    expect(await screen.findByRole("button", { name: INVITE })).toBeDefined();

    vi.stubGlobal("fetch", answeringAs("Viewer"));
    await clients.queryClient.refetchQueries({ queryKey: [["session", "member"]] });
    await rail().findByRole("link", { name: "Ask" });

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

    expect(heading()).toBe("This Page Didn’t Load");
    expect(router.state.location.pathname).toBe("/");
  });

  it("sends the person home once asking again reads their role", async () => {
    const clients = withTheApiDown();
    const router = await openAt("/", clients);
    await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

    vi.stubGlobal("fetch", answering(undefined, "Viewer"));
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Viewer.path));
  });
});
