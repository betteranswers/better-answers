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
import { ALL_WORKSPACES } from "@/app/words.ts";
import { WorkspaceSwitcher } from "@/app/workspace-switcher.tsx";
import { SwitchRefused, useSwitchWorkspace } from "@/features/auth/auth-hooks.ts";
import { useTRPC } from "@/shared/api/trpc.ts";
import { CONSOLE } from "@/shared/navigation.ts";

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

type Switching = Parameters<typeof WorkspaceSwitcher>[0]["switching"];

const HOLME = { id: "h", name: "Holme Valley Tools", slug: "holme", createdAt: new Date() };

const aSwitch = (pending: boolean): Switching => ({
  open: true,
  onOpenChange: () => undefined,
  pending,
  workspaces: [HOLME],
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
const openTheMenu = async (pending: boolean) => {
  vi.stubGlobal("ResizeObserver", measuresNothing);
  const root = createRootRoute({
    component: () => (
      <>
        <WorkspaceSwitcher
          here={{ name: "Northern Tooling", workspaceId: "w" }}
          offersTheConsole
          switching={aSwitch(pending)}
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

/** The switch's hook alone, with the api's proxy beside it for reading and seeding the cache. */
const switchHeld = async () => {
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
  const { result } = renderHook(() => ({ switching: useSwitchWorkspace(), api: useTRPC() }), {
    wrapper,
  });
  return { queryClient: clients.queryClient, result };
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the workspace switcher's ways out", () => {
  it.each([ALL_WORKSPACES, CONSOLE.name])("holds %s while a switch is pending", async (name) => {
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

    const way = screen.getByRole("menuitem", { name: ALL_WORKSPACES });
    fireEvent.click(way);

    expect(way.getAttribute("aria-disabled")).toBeNull();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/choose-workspace"));
  });
});

describe("a switch's refusal", () => {
  it.each([
    ["USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION", true],
    ["FORBIDDEN", false],
  ])("reads %s in the platform's terms", async (code, noLongerAMember) => {
    authServer.answer = answeringTheSwitch(refusedWith(code));
    const { result } = await switchHeld();

    act(() => result.current.switching.mutate(HOLME));

    await vi.waitFor(() => expect(result.current.switching.isError).toBe(true));
    expect(result.current.switching.error).toBeInstanceOf(SwitchRefused);
    expect(result.current.switching.error?.noLongerAMember).toBe(noLongerAMember);
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
