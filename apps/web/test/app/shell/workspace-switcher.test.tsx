import { onlineManager } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterContextProvider,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { WorkspaceSwitcher } from "@/app/shell/workspace-switcher.tsx";
import { ALL_WORKSPACES, JUMP_TO } from "@/app/words.ts";
import {
  SwitchRefused,
  useAcceptInvitation,
  useSetActiveOrganization,
  useSwitchWorkspace,
} from "@/features/auth/auth-hooks.ts";
import { noLongerAMemberOf } from "@/features/auth/refusal-words.ts";
import { PICKER_WORDS } from "@/features/auth/workspace/workspace-words.ts";
import { MEMBERS_LOADING } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members/members-address.ts";
import { useTRPC } from "@/shared/api/trpc.ts";
import { HOMES } from "@/shared/navigation.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { server, type Asked } from "@test/stub-server.ts";
import {
  addressOf,
  answered,
  answeringAs,
  heldBack,
  type Api,
  type Held,
} from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  band,
  drawnWithNoWorkspace,
  GRACE,
  HEDY,
  HOLME,
  LOST,
  NORTHERN,
  openAt,
  read,
  switcher,
  switcherDrawn,
  tickOf,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

type Drawn = Parameters<typeof WorkspaceSwitcher>[0];

type Switching = Drawn["switching"];

const HOLME_LISTED = { ...HOLME, role: "Viewer" };

type Standing = Pick<Drawn, "here"> & Pick<Switching, "workspaces">;

const IN_NORTHERN: Standing = {
  here: { name: "Northern Tooling", workspaceId: "w", role: "Admin" },
  workspaces: [HOLME_LISTED],
};

const aSwitch = (pending: boolean, workspaces: Switching["workspaces"]): Switching => ({
  open: true,
  onOpenChange: () => undefined,
  pending,
  workspaces,
  switchTo: () => undefined,
  outcome: undefined,
});

const openTheMenu = async (pending: boolean, standing: Standing = IN_NORTHERN) => {
  const root = createRootRoute({
    component: () => (
      <>
        <WorkspaceSwitcher
          here={standing.here}
          offersTheConsole
          switching={aSwitch(pending, standing.workspaces)}
        />
        <Outlet />
      </>
    ),
  });
  const ways = ["/people/members", "/choose-workspace", "/console"].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren(ways),
    history: createMemoryHistory({ initialEntries: ["/people/members"] }),
  });
  await router.load();
  render(
    <Providers clients={createAppClients()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
};

const answeringTheSwitch =
  (answer: () => Promise<Response>) =>
  (input: Asked): Promise<Response> =>
    addressOf(input).pathname === "/organization/set-active"
      ? answer()
      : answeringAs("Admin")(input);

const refusedWith = (code: string) => () =>
  Promise.resolve(
    new Response(JSON.stringify({ code, message: "refused" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  );

const renderTheHook = async <TResult,>(hook: () => TResult) => {
  const clients = createAppClients();
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const wrapper = (properties: { readonly children: ReactNode }) => (
    <Providers clients={clients}>
      <RouterContextProvider router={router}>{properties.children}</RouterContextProvider>
    </Providers>
  );
  const { result } = renderHook(hook, { wrapper });
  return { queryClient: clients.queryClient, result };
};

const switchHeld = () => renderTheHook(() => ({ switching: useSwitchWorkspace(), api: useTRPC() }));

const overTheListHeld = async <TResult,>(hook: () => TResult) => {
  const { queryClient, result } = await renderTheHook(() => ({ held: hook(), api: useTRPC() }));
  const listKey = result.current.api.person.workspaces.queryKey();
  queryClient.setQueryData(listKey, []);
  return { queryClient, result, listKey };
};

const answeringTheJoin = (input: Asked): Promise<Response> =>
  addressOf(input).pathname.includes("person.acceptInvitation")
    ? answered([{ result: { data: { workspaceId: HOLME.id } } }])
    : answeringAs("Admin")(input);

const itemsListed = () =>
  screen.getAllByRole("menuitemradio").map((workspace) => workspace.textContent);

describe("the workspace switcher's list", () => {
  it("says each workspace's role after its name, the open first", async () => {
    await openTheMenu(false);

    expect(itemsListed()).toEqual(["Northern Tooling Admin", "Holme Valley Tools Viewer"]);
  });

  it("says the open workspace's role before the list answers", async () => {
    await openTheMenu(false, { ...IN_NORTHERN, workspaces: [] });

    expect(itemsListed()).toEqual(["Northern Tooling Admin"]);
  });

  it("says each role from the list alone in the console", async () => {
    await openTheMenu(false, {
      here: { name: "Console", workspaceId: undefined },
      workspaces: [HOLME_LISTED],
    });

    expect(itemsListed()).toEqual(["Holme Valley Tools Viewer"]);
  });
});

describe("the workspace switcher's ways out", () => {
  it.each(["All Workspaces", "Console"])("holds %s while a switch is pending", async (name) => {
    const router = await openTheMenu(true);
    const navigating = vi.spyOn(router, "navigate");

    const way = screen.getByRole("menuitem", { name });
    fireEvent.click(way);

    expect(way.getAttribute("aria-disabled")).toBe("true");
    expect(navigating).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/people/members");
  });

  it("takes the person to all workspaces once nothing is pending", async () => {
    const router = await openTheMenu(false);

    const way = screen.getByRole("menuitem", { name: "All Workspaces" });
    fireEvent.click(way);

    expect(way.getAttribute("aria-disabled")).toBeNull();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/choose-workspace"));
  });
});

describe("a switch's refusal", () => {
  it.each([
    ["USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION", true],
    ["FORBIDDEN", false],
  ])("turns a switch refused with %s into the platform's terms", async (code, noLongerAMember) => {
    server.answer = answeringTheSwitch(refusedWith(code));
    const { result } = await switchHeld();

    act(() => result.current.switching.mutate(HOLME));

    await vi.waitFor(() => expect(result.current.switching.isError).toBe(true));
    expect(result.current.switching.error).toBeInstanceOf(SwitchRefused);
    expect(result.current.switching.error?.noLongerAMember).toBe(noLongerAMember);
  });

  it.each([
    ["USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION", true],
    ["FORBIDDEN", false],
  ])("turns a pick refused with %s into the platform's terms", async (code, noLongerAMember) => {
    server.answer = answeringTheSwitch(refusedWith(code));
    const { result } = await renderTheHook(useSetActiveOrganization);

    act(() => result.current.mutate({ organizationId: HOLME.id }));

    await vi.waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SwitchRefused);
    expect(result.current.error?.noLongerAMember).toBe(noLongerAMember);
  });
});

describe("a switch that lands", () => {
  it("keeps the console's reads and drops the workspace's", async () => {
    server.answer = answeringTheSwitch(() => answered({ id: HOLME.id }));
    const { queryClient, result } = await switchHeld();
    const { api } = result.current;
    const consoleKey = api.console.workspaces.list.queryKey();
    const membersKey = api.members.list.queryKey();
    queryClient.setQueryData(consoleKey, []);
    queryClient.setQueryData(membersKey, []);

    act(() => result.current.switching.mutate(HOLME));

    await vi.waitFor(() => expect(result.current.switching.isSuccess).toBe(true));
    expect(queryClient.getQueryData(consoleKey)).toEqual([]);
    expect(queryClient.getQueryData(membersKey)).toBeUndefined();
  });
});

describe("the person's workspace list, held", () => {
  it("stays through a switch, so the menu opens on it", async () => {
    server.answer = answeringTheSwitch(() => answered({ id: HOLME.id }));
    const { queryClient, result, listKey } = await overTheListHeld(useSwitchWorkspace);

    act(() => result.current.held.mutate(HOLME));

    await vi.waitFor(() => expect(result.current.held.isSuccess).toBe(true));
    expect(queryClient.getQueryData(listKey)).toEqual([]);
  });

  it("stays through a pick, marked stale", async () => {
    server.answer = answeringTheSwitch(() => answered({ id: HOLME.id }));
    const { queryClient, result, listKey } = await overTheListHeld(useSetActiveOrganization);

    act(() => result.current.held.mutate({ organizationId: HOLME.id }));

    await vi.waitFor(() => expect(result.current.held.isSuccess).toBe(true));
    expect(queryClient.getQueryState(listKey)).toMatchObject({ data: [], isInvalidated: true });
  });

  it("is dropped by a join, which adds a workspace", async () => {
    server.answer = answeringTheJoin;
    const { queryClient, result, listKey } = await overTheListHeld(useAcceptInvitation);

    act(() => result.current.held.mutate({ invitationId: "i" }));

    await vi.waitFor(() => expect(result.current.held.isSuccess).toBe(true));
    expect(queryClient.getQueryState(listKey)).toBeUndefined();
  });
});

const SET_ACTIVE = "/organization/set-active";

const NOT_A_MEMBER = "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION";

const MEMBERS = HOMES.Admin.path;

const GRACES_PAGE = memberPageOf(GRACE.personId);

const textOf = (items: readonly HTMLElement[]) => items.map((item) => item.textContent);

const openedMenu = async (here = NORTHERN) => {
  fireEvent.keyDown(await switcher(here), { key: "ArrowDown" });
  return screen.findByRole("menu", { name: here.name });
};

const switchedToHolme = async () => {
  const menu = await openedMenu();
  fireEvent.click(await within(menu).findByRole("menuitemradio", { name: `${HOLME.name} Viewer` }));
};

const landingInHolme = (api: Api, whenAnswered: () => void = () => undefined) => {
  api.set(SET_ACTIVE, () => {
    api.set("session.member", () => adaAt("Admin", HOLME));
    api.set("members.invitations", () => read([]));
    whenAnswered();
    return { id: HOLME.id };
  });
};

const answeringTheSwitchWith = (answer: () => Promise<Response>) => {
  const rest = server.answer;
  server.answer = (asked, init) =>
    addressOf(asked).pathname === SET_ACTIVE ? answer() : rest(asked, init);
};

const openAtTheMembers = async (api: Api = adaAnAdmin()) => {
  const router = await openAt(MEMBERS, api);
  await waitFor(() => expect(tickOf(GRACE.displayName)).not.toBeNull());
  return router;
};

const newMembersLoaded = async (list: Held) => {
  expect(await screen.findByText(MEMBERS_LOADING)).toBeDefined();
  list.resolve();
  await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
};

const BOTH = [`${NORTHERN.name} Admin`, `${HOLME.name} Viewer`];

const home = (name: string) => screen.findByRole("heading", { level: 1, name });

describe("the workspace switcher in the app", () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("lists the operator's workspaces and Console, others none", async () => {
    const operators = adaAnAdmin();
    operators.set("session.operator", () => read({ operator: true, name: ADA.displayName }));
    const router = await openAt(MEMBERS, operators);

    const menu = await openedMenu();

    await waitFor(() => expect(textOf(within(menu).getAllByRole("menuitemradio"))).toEqual(BOTH));
    expect(within(menu).getAllByRole("menuitemradio")[0]?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(textOf(within(menu).getAllByRole("menuitem"))).toEqual([ALL_WORKSPACES, "Console"]);
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(await switcher());
    fireEvent.click(within(await openedMenu()).getByRole("menuitem", { name: "Console" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.operator.path));
    fireEvent.keyDown(await band().findByRole("button", { name: ADA.displayName }), {
      key: "Enter",
    });
    const person = await screen.findByRole("menu", { name: new RegExp(ADA.displayName) });
    expect(within(person).getByText(ADA.displayName)).toBeDefined();
    expect(textOf(within(person).getAllByRole("menuitem"))).toEqual(["Account", "Sign Out"]);

    cleanup();
    await openAt(MEMBERS, adaAnAdmin());
    const theirs = await openedMenu();

    await waitFor(() => expect(textOf(within(theirs).getAllByRole("menuitemradio"))).toEqual(BOTH));
    expect(textOf(within(theirs).getAllByRole("menuitem"))).toEqual([ALL_WORKSPACES]);
  });

  it("switching from a member page lands home, showing no one", async () => {
    const api = adaAnAdmin();
    const router = await openAt(GRACES_PAGE, api);
    await within(screen.getByRole("main")).findByRole("heading", {
      level: 2,
      name: GRACE.displayName,
    });
    landingInHolme(api);
    const list = heldBack(api, "members.list", read([ADA, HEDY]));

    await switchedToHolme();

    await switcher(HOLME);
    expect(await home("People")).toBeDefined();
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(document.body.textContent, "drew a person from the left workspace").not.toContain(
      GRACE.displayName,
    );
    await newMembersLoaded(list);
  });

  it("drops the left workspace's members when All workspaces picks another", async () => {
    const api = adaAnAdmin();
    const router = await openAtTheMembers(api);
    landingInHolme(api);

    const menu = await openedMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: ALL_WORKSPACES }));
    const holme = await screen.findByRole("button", { name: HOLME.name });
    const list = heldBack(api, "members.list", read([ADA, HEDY]));
    fireEvent.click(holme);

    await waitFor(() => expect(switcherDrawn(HOLME)).not.toBeNull());
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(tickOf(GRACE.displayName), "drew the left workspace's members").toBeNull();
    fireEvent.click(band().getByRole("button", { name: JUMP_TO.name }));
    const jumpTo = await screen.findByRole("dialog", { name: JUMP_TO.name });
    const search = within(jumpTo).getByRole("combobox");
    fireEvent.change(search, { target: { value: GRACE.displayName } });
    expect(within(jumpTo).getByRole("status").textContent).toBe(JUMP_TO.membersLoading);
    expect(
      within(jumpTo).queryByRole("group", { name: JUMP_TO.groups.members }),
      "jump-to offered the left workspace's members",
    ).toBeNull();

    list.resolve();
    fireEvent.change(search, { target: { value: HEDY.displayName } });
    const members = await within(jumpTo).findByRole("group", { name: JUMP_TO.groups.members });
    expect(members.textContent).toContain(HEDY.displayName);
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
  });

  it("says a refused switch in the band, keeping the page", async () => {
    const router = await openAtTheMembers();
    answeringTheSwitchWith(refusedWith(NOT_A_MEMBER));

    await switchedToHolme();

    await waitFor(() =>
      expect(band().getByRole("alert").textContent).toBe(noLongerAMemberOf(HOLME.name)),
    );
    expect(document.activeElement, "focus left the switcher").toBe(await switcher());
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(tickOf(GRACE.displayName)).not.toBeNull();
    const menu = await openedMenu();
    expect(textOf(within(menu).getAllByRole("menuitemradio"))).toEqual([`${NORTHERN.name} Admin`]);
  });

  it("says an unanswered switch in the band, keeping the page", async () => {
    const router = await openAtTheMembers();
    answeringTheSwitchWith(() => Promise.reject(new TypeError("Failed to fetch")));

    await switchedToHolme();

    await waitFor(() => expect(band().getByRole("alert").textContent).toBe(STOCK.general));
    expect(document.activeElement, "focus left the switcher").toBe(await switcher());
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(tickOf(GRACE.displayName)).not.toBeNull();
  });

  it("drops the left workspace's name when the member read fails", async () => {
    const api = adaAnAdmin();
    const router = await openAtTheMembers(api);
    landingInHolme(api, () => {
      api.set("session.member", () => LOST);
    });

    await switchedToHolme();

    await drawnWithNoWorkspace();
    expect(within(screen.getByRole("main")).getByRole("alert").textContent).toMatch(/\S/);
    expect(router.state.location.pathname).toBe("/");

    api.set("session.member", () => adaAt("Admin", HOLME));
    fireEvent.click(screen.getByRole("button", { name: PICKER_WORDS.tryAgain }));

    await switcher(HOLME);
    expect(router.state.location.pathname).toBe(MEMBERS);
  });

  it("drops the left workspace's name while the switch waits offline", async () => {
    const api = adaAnAdmin();
    const router = await openAtTheMembers(api);
    landingInHolme(api, () => {
      onlineManager.setOnline(false);
    });

    await switchedToHolme();

    await waitFor(() =>
      expect(switcherDrawn(NORTHERN), "the band still names the workspace left").toBeNull(),
    );
    expect(band().getByRole("status").textContent).toBe(PICKER_WORDS.opening);

    act(() => {
      onlineManager.setOnline(true);
    });

    await switcher(HOLME);
    expect(router.state.location.pathname).toBe(MEMBERS);
  });
});
