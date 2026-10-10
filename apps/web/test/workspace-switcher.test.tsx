import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterContextProvider,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { WorkspaceSwitcher } from "@/app/workspace-switcher.tsx";
import {
  SwitchRefused,
  useAcceptInvitation,
  useSetActiveOrganization,
  useSwitchWorkspace,
} from "@/features/auth/auth-hooks.ts";
import { useTRPC } from "@/shared/api/trpc.ts";

import { addressOf, answered, answeringAs } from "./stubbed-api.ts";

type Asked = string | URL | Request;

/** Better Auth's client keeps the `fetch` it finds when made, so this one stands first. */
const authServer = vi.hoisted(() => {
  const server = {
    answer: (_asked: Asked): Promise<Response> => Promise.reject(new TypeError("unanswered")),
  };
  globalThis.fetch = (asked: Asked) => server.answer(asked);
  return server;
});

type Drawn = Parameters<typeof WorkspaceSwitcher>[0];

type Switching = Drawn["switching"];

const HOLME = { id: "h", name: "Holme Valley Tools", role: "Viewer" };

/** Where the switcher is drawn, and what its list has answered. */
type Standing = Pick<Drawn, "here"> & Pick<Switching, "workspaces">;

const IN_NORTHERN: Standing = {
  here: { name: "Northern Tooling", workspaceId: "w", role: "Admin" },
  workspaces: [HOLME],
};

const aSwitch = (pending: boolean, workspaces: Switching["workspaces"]): Switching => ({
  open: true,
  onOpenChange: () => undefined,
  pending,
  workspaces,
  switchTo: () => undefined,
  outcome: undefined,
});

/** The popper measures what it places, which jsdom cannot. */
const measuresNothing = class {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
};

/** The switcher alone, open, over a router that can take each of its ways out. */
const openTheMenu = async (pending: boolean, standing: Standing = IN_NORTHERN) => {
  vi.stubGlobal("ResizeObserver", measuresNothing);
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

/** Set-active answers as `answer` says; every other read as Ada's, an Admin of Northern Tooling. */
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

/** One hook alone, over the app's clients and a router it can navigate. */
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

/** The switch's hook, with the api's proxy beside it for reading and seeding the cache. */
const switchHeld = () => renderTheHook(() => ({ switching: useSwitchWorkspace(), api: useTRPC() }));

/** A hook over a cache that already holds the person's workspace list, as an opened menu leaves it. */
const overTheListHeld = async <TResult,>(hook: () => TResult) => {
  const { queryClient, result } = await renderTheHook(() => ({ held: hook(), api: useTRPC() }));
  const listKey = result.current.api.person.workspaces.queryKey();
  queryClient.setQueryData(listKey, []);
  return { queryClient, result, listKey };
};

/** The join answers; every other read as Ada's, an Admin of Northern Tooling. */
const answeringTheJoin = (input: Asked): Promise<Response> =>
  addressOf(input).pathname.includes("person.acceptInvitation")
    ? answered([{ result: { data: { workspaceId: HOLME.id } } }])
    : answeringAs("Admin")(input);

const itemsListed = () =>
  screen.getAllByRole("menuitemradio").map((workspace) => workspace.textContent);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
      workspaces: [HOLME],
    });

    expect(itemsListed()).toEqual(["Holme Valley Tools Viewer"]);
  });
});

describe("the workspace switcher's ways out", () => {
  it.each(["All workspaces", "Console"])("holds %s while a switch is pending", async (name) => {
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

    const way = screen.getByRole("menuitem", { name: "All workspaces" });
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
    authServer.answer = answeringTheSwitch(refusedWith(code));
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
    authServer.answer = answeringTheSwitch(refusedWith(code));
    const { result } = await renderTheHook(useSetActiveOrganization);

    act(() => result.current.mutate({ organizationId: HOLME.id }));

    await vi.waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SwitchRefused);
    expect(result.current.error?.noLongerAMember).toBe(noLongerAMember);
  });
});

describe("a switch that lands", () => {
  it("keeps the console's reads and drops the workspace's", async () => {
    authServer.answer = answeringTheSwitch(() => answered({ id: HOLME.id }));
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
    authServer.answer = answeringTheSwitch(() => answered({ id: HOLME.id }));
    const { queryClient, result, listKey } = await overTheListHeld(useSwitchWorkspace);

    act(() => result.current.held.mutate(HOLME));

    await vi.waitFor(() => expect(result.current.held.isSuccess).toBe(true));
    expect(queryClient.getQueryData(listKey)).toEqual([]);
  });

  it("stays through a pick, marked stale", async () => {
    authServer.answer = answeringTheSwitch(() => answered({ id: HOLME.id }));
    const { queryClient, result, listKey } = await overTheListHeld(useSetActiveOrganization);

    act(() => result.current.held.mutate({ organizationId: HOLME.id }));

    await vi.waitFor(() => expect(result.current.held.isSuccess).toBe(true));
    expect(queryClient.getQueryState(listKey)).toMatchObject({ data: [], isInvalidated: true });
  });

  it("is dropped by a join, which adds a workspace", async () => {
    authServer.answer = answeringTheJoin;
    const { queryClient, result, listKey } = await overTheListHeld(useAcceptInvitation);

    act(() => result.current.held.mutate({ invitationId: "i" }));

    await vi.waitFor(() => expect(result.current.held.isSuccess).toBe(true));
    expect(queryClient.getQueryState(listKey)).toBeUndefined();
  });
});
