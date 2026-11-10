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
import { SIGN_OUT } from "@/shared/words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { server, type Asked } from "@test/stub-server.ts";
import {
  addressOf,
  answered,
  answeringAs,
  holdProcedure,
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

type SwitcherProps = Parameters<typeof WorkspaceSwitcher>[0];

type Switching = SwitcherProps["switching"];

const HOLME_LISTED = { ...HOLME, role: "Viewer" };

type MenuState = Pick<SwitcherProps, "here"> & Pick<Switching, "workspaces">;

const IN_NORTHERN: MenuState = {
  here: { name: "Northern Tooling", workspaceId: "w", role: "Admin" },
  workspaces: [HOLME_LISTED],
};

const switchingProps = (pending: boolean, workspaces: Switching["workspaces"]): Switching => ({
  open: true,
  onOpenChange: () => undefined,
  pending,
  workspaces,
  switchTo: () => undefined,
  outcome: undefined,
});

const renderSwitcherMenu = async (pending: boolean, state: MenuState = IN_NORTHERN) => {
  const root = createRootRoute({
    component: () => (
      <>
        <WorkspaceSwitcher
          here={state.here}
          offersTheConsole
          switching={switchingProps(pending, state.workspaces)}
        />
        <Outlet />
      </>
    ),
  });
  const routes = ["/people/members", "/choose-workspace", "/console"].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
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

const answeringSetActiveWith =
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

const renderWithRouter = async <TResult,>(hook: () => TResult) => {
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

const renderSwitchHook = () =>
  renderWithRouter(() => ({ switching: useSwitchWorkspace(), api: useTRPC() }));

const renderWithCachedWorkspaceList = async <TResult,>(hook: () => TResult) => {
  const { queryClient, result } = await renderWithRouter(() => ({
    mutation: hook(),
    api: useTRPC(),
  }));
  const listKey = result.current.api.person.workspaces.queryKey();
  queryClient.setQueryData(listKey, []);
  return { queryClient, result, listKey };
};

const answeringAcceptInvitation = (input: Asked): Promise<Response> =>
  addressOf(input).pathname.includes("person.acceptInvitation")
    ? answered([{ result: { data: { workspaceId: HOLME.id } } }])
    : answeringAs("Admin")(input);

const workspaceItems = () =>
  screen.getAllByRole("menuitemradio").map((workspace) => workspace.textContent);

describe("the workspace switcher's list", () => {
  it("shows each workspace's role after its name, current first", async () => {
    await renderSwitcherMenu(false);

    expect(workspaceItems()).toEqual(["Northern Tooling Admin", "Holme Valley Tools Viewer"]);
  });

  it("shows the current workspace's role before the list loads", async () => {
    await renderSwitcherMenu(false, { ...IN_NORTHERN, workspaces: [] });

    expect(workspaceItems()).toEqual(["Northern Tooling Admin"]);
  });

  it("shows only the listed workspaces in the console", async () => {
    await renderSwitcherMenu(false, {
      here: { name: "Console", workspaceId: undefined },
      workspaces: [HOLME_LISTED],
    });

    expect(workspaceItems()).toEqual(["Holme Valley Tools Viewer"]);
  });
});

describe("the workspace switcher's navigation items", () => {
  it.each([ALL_WORKSPACES, "Console"])("disables %s while a switch is pending", async (name) => {
    const router = await renderSwitcherMenu(true);
    const navigate = vi.spyOn(router, "navigate");

    const item = screen.getByRole("menuitem", { name });
    fireEvent.click(item);

    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(navigate).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/people/members");
  });

  it("opens All Workspaces when no switch is pending", async () => {
    const router = await renderSwitcherMenu(false);

    const item = screen.getByRole("menuitem", { name: ALL_WORKSPACES });
    fireEvent.click(item);

    expect(item.getAttribute("aria-disabled")).toBeNull();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/choose-workspace"));
  });
});

describe("a switch's refusal", () => {
  it.each([
    ["USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION", true],
    ["FORBIDDEN", false],
  ])("maps a switch refused with %s to SwitchRefused", async (code, noLongerAMember) => {
    server.answer = answeringSetActiveWith(refusedWith(code));
    const { result } = await renderSwitchHook();

    act(() => result.current.switching.mutate(HOLME));

    await vi.waitFor(() => expect(result.current.switching.isError).toBe(true));
    expect(result.current.switching.error).toBeInstanceOf(SwitchRefused);
    expect(result.current.switching.error?.noLongerAMember).toBe(noLongerAMember);
  });

  it.each([
    ["USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION", true],
    ["FORBIDDEN", false],
  ])("maps a pick refused with %s to SwitchRefused", async (code, noLongerAMember) => {
    server.answer = answeringSetActiveWith(refusedWith(code));
    const { result } = await renderWithRouter(useSetActiveOrganization);

    act(() => result.current.mutate({ organizationId: HOLME.id }));

    await vi.waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SwitchRefused);
    expect(result.current.error?.noLongerAMember).toBe(noLongerAMember);
  });
});

describe("a successful switch", () => {
  it("keeps console queries and removes workspace queries", async () => {
    server.answer = answeringSetActiveWith(() => answered({ id: HOLME.id }));
    const { queryClient, result } = await renderSwitchHook();
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

describe("the cached workspace list", () => {
  it("survives a switch so the menu opens with it", async () => {
    server.answer = answeringSetActiveWith(() => answered({ id: HOLME.id }));
    const { queryClient, result, listKey } =
      await renderWithCachedWorkspaceList(useSwitchWorkspace);

    act(() => result.current.mutation.mutate(HOLME));

    await vi.waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(queryClient.getQueryData(listKey)).toEqual([]);
  });

  it("survives a pick and is marked stale", async () => {
    server.answer = answeringSetActiveWith(() => answered({ id: HOLME.id }));
    const { queryClient, result, listKey } =
      await renderWithCachedWorkspaceList(useSetActiveOrganization);

    act(() => result.current.mutation.mutate({ organizationId: HOLME.id }));

    await vi.waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(queryClient.getQueryState(listKey)).toMatchObject({ data: [], isInvalidated: true });
  });

  it("is removed after joining a workspace", async () => {
    server.answer = answeringAcceptInvitation;
    const { queryClient, result, listKey } =
      await renderWithCachedWorkspaceList(useAcceptInvitation);

    act(() => result.current.mutation.mutate({ invitationId: "i" }));

    await vi.waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(queryClient.getQueryState(listKey)).toBeUndefined();
  });
});

const SET_ACTIVE = "/organization/set-active";

const NOT_A_MEMBER = "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION";

const MEMBERS = HOMES.Admin.path;

const GRACES_PAGE = memberPageOf(GRACE.personId);

const textOf = (items: readonly HTMLElement[]) => items.map((item) => item.textContent);

const openSwitcherMenu = async (here = NORTHERN) => {
  fireEvent.keyDown(await switcher(here), { key: "ArrowDown" });
  return screen.findByRole("menu", { name: here.name });
};

const switchToHolme = async () => {
  const menu = await openSwitcherMenu();
  fireEvent.click(await within(menu).findByRole("menuitemradio", { name: `${HOLME.name} Viewer` }));
};

const setActiveLandsInHolme = (api: Api, onSetActive: () => void = () => undefined) => {
  api.set(SET_ACTIVE, () => {
    api.set("session.member", () => adaAt("Admin", HOLME));
    api.set("members.invitations", () => read([]));
    onSetActive();
    return { id: HOLME.id };
  });
};

const answerSetActiveWith = (answer: () => Promise<Response>) => {
  const answerOthers = server.answer;
  server.answer = (asked, init) =>
    addressOf(asked).pathname === SET_ACTIVE ? answer() : answerOthers(asked, init);
};

const openMembersPage = async (api: Api = adaAnAdmin()) => {
  const router = await openAt(MEMBERS, api);
  await waitFor(() => expect(tickOf(GRACE.displayName)).not.toBeNull());
  return router;
};

const loadNewMembers = async (list: Held) => {
  expect(await screen.findByText(MEMBERS_LOADING)).toBeDefined();
  list.resolve();
  await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
};

const BOTH_WORKSPACES = [`${NORTHERN.name} Admin`, `${HOLME.name} Viewer`];

const findPageHeading = (name: string) => screen.findByRole("heading", { level: 1, name });

describe("the workspace switcher in the app", () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("lists workspaces for everyone and Console only for operatorApi", async () => {
    const operatorApi = adaAnAdmin();
    operatorApi.set("session.operator", () => read({ operator: true, name: ADA.displayName }));
    const router = await openAt(MEMBERS, operatorApi);

    const menu = await openSwitcherMenu();

    await waitFor(() =>
      expect(textOf(within(menu).getAllByRole("menuitemradio"))).toEqual(BOTH_WORKSPACES),
    );
    expect(within(menu).getAllByRole("menuitemradio")[0]?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(textOf(within(menu).getAllByRole("menuitem"))).toEqual([ALL_WORKSPACES, "Console"]);
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(await switcher());
    fireEvent.click(within(await openSwitcherMenu()).getByRole("menuitem", { name: "Console" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.operator.path));
    fireEvent.keyDown(await band().findByRole("button", { name: ADA.displayName }), {
      key: "Enter",
    });
    const person = await screen.findByRole("menu", { name: ADA.displayName });
    expect(within(person).getByText(ADA.displayName)).toBeDefined();
    expect(textOf(within(person).getAllByRole("menuitem"))).toEqual(["Account", SIGN_OUT]);

    cleanup();
    await openAt(MEMBERS, adaAnAdmin());
    const nonOperatorMenu = await openSwitcherMenu();

    await waitFor(() =>
      expect(textOf(within(nonOperatorMenu).getAllByRole("menuitemradio"))).toEqual(
        BOTH_WORKSPACES,
      ),
    );
    expect(textOf(within(nonOperatorMenu).getAllByRole("menuitem"))).toEqual([ALL_WORKSPACES]);
  });

  it("goes to Members after switching from a member page", async () => {
    const api = adaAnAdmin();
    const router = await openAt(GRACES_PAGE, api);
    await within(screen.getByRole("main")).findByRole("heading", {
      level: 1,
      name: GRACE.displayName,
    });
    setActiveLandsInHolme(api);
    const list = holdProcedure(api, "members.list", read([ADA, HEDY]));

    await switchToHolme();

    await switcher(HOLME);
    expect(await findPageHeading("Members")).toBeDefined();
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(
      document.body.textContent,
      "the page shows a person from the previous workspace",
    ).not.toContain(GRACE.displayName);
    await loadNewMembers(list);
  });

  it("clears old members after picking from All Workspaces", async () => {
    const api = adaAnAdmin();
    const router = await openMembersPage(api);
    setActiveLandsInHolme(api);

    const menu = await openSwitcherMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: ALL_WORKSPACES }));
    const holme = await screen.findByRole("button", { name: HOLME.name });
    const list = holdProcedure(api, "members.list", read([ADA, HEDY]));
    fireEvent.click(holme);

    await waitFor(() => expect(switcherDrawn(HOLME)).not.toBeNull());
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(tickOf(GRACE.displayName), "the list shows the previous workspace's members").toBeNull();
    fireEvent.click(band().getByRole("button", { name: JUMP_TO.name }));
    const jumpTo = await screen.findByRole("dialog", { name: JUMP_TO.name });
    const search = within(jumpTo).getByRole("combobox");
    fireEvent.change(search, { target: { value: GRACE.displayName } });
    expect(within(jumpTo).getByRole("status").textContent).toBe(JUMP_TO.membersLoading);
    expect(
      within(jumpTo).queryByRole("group", { name: JUMP_TO.groups.members }),
      "jump-to offers the previous workspace's members",
    ).toBeNull();

    list.resolve();
    fireEvent.change(search, { target: { value: HEDY.displayName } });
    const members = await within(jumpTo).findByRole("group", { name: JUMP_TO.groups.members });
    expect(members.textContent).toContain(HEDY.displayName);
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
  });

  it("shows a refused switch in the band, keeping the page", async () => {
    const router = await openMembersPage();
    answerSetActiveWith(refusedWith(NOT_A_MEMBER));

    await switchToHolme();

    await waitFor(() =>
      expect(band().getByRole("alert").textContent).toBe(noLongerAMemberOf(HOLME.name)),
    );
    expect(document.activeElement, "focus left the switcher").toBe(await switcher());
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(tickOf(GRACE.displayName)).not.toBeNull();
    const menu = await openSwitcherMenu();
    expect(textOf(within(menu).getAllByRole("menuitemradio"))).toEqual([`${NORTHERN.name} Admin`]);
  });

  it("shows a network failure in the band, keeping the page", async () => {
    const router = await openMembersPage();
    answerSetActiveWith(() => Promise.reject(new TypeError("Failed to fetch")));

    await switchToHolme();

    await waitFor(() => expect(band().getByRole("alert").textContent).toBe(STOCK.general));
    expect(document.activeElement, "focus left the switcher").toBe(await switcher());
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(tickOf(GRACE.displayName)).not.toBeNull();
  });

  it("removes the old workspace name when the member read fails", async () => {
    const api = adaAnAdmin();
    const router = await openMembersPage(api);
    setActiveLandsInHolme(api, () => {
      api.set("session.member", () => LOST);
    });

    await switchToHolme();

    await drawnWithNoWorkspace();
    expect(within(screen.getByRole("main")).getByRole("alert").textContent).toMatch(/\S/);
    expect(router.state.location.pathname).toBe("/");

    api.set("session.member", () => adaAt("Admin", HOLME));
    fireEvent.click(screen.getByRole("button", { name: PICKER_WORDS.tryAgain }));

    await switcher(HOLME);
    expect(router.state.location.pathname).toBe(MEMBERS);
  });

  it("removes the old workspace name while the switch waits offline", async () => {
    const api = adaAnAdmin();
    const router = await openMembersPage(api);
    setActiveLandsInHolme(api, () => {
      onlineManager.setOnline(false);
    });

    await switchToHolme();

    await waitFor(() =>
      expect(switcherDrawn(NORTHERN), "the band still shows the previous workspace").toBeNull(),
    );
    expect(band().getByRole("status").textContent).toBe(PICKER_WORDS.opening);

    act(() => {
      onlineManager.setOnline(true);
    });

    await switcher(HOLME);
    expect(router.state.location.pathname).toBe(MEMBERS);
  });
});
