import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  type AnyRoute,
  type RouterHistory,
} from "@tanstack/react-router";
import type { ReactElement } from "react";

import { AcceptInvitationScreen } from "@/features/auth/accept-invitation-screen.tsx";
import { acceptDetour, displayNameDetour } from "@/features/auth/auth-hooks.ts";
import { backTo, leavingFor, pageQuery } from "@/features/auth/carried-flow.ts";
import { ChooseWorkspaceScreen } from "@/features/auth/choose-workspace-screen.tsx";
import { DisplayNameScreen } from "@/features/auth/display-name-screen.tsx";
import {
  membershipRefusal,
  NEEDS_A_PICK,
  roleHeld,
  useMembership,
} from "@/features/auth/membership.ts";
import { NoWorkspaceScreen } from "@/features/auth/no-workspace-screen.tsx";
import { SignInScreen } from "@/features/auth/sign-in-screen.tsx";
import { EVERYONE_TOOLBAR, EveryoneScreen } from "@/features/console/everyone-screen.tsx";
import {
  NAMES_WAITING_TOOLBAR,
  NamesWaitingScreen,
} from "@/features/console/names-waiting-screen.tsx";
import { mustSignInForTheConsole } from "@/features/console/operator.ts";
import { WorkspacesScreen } from "@/features/console/workspaces-screen.tsx";
import { AUDIT_LOG_TOOLBAR, AuditLogScreen } from "@/features/people/audit-log-screen.tsx";
import { GROUPS_TOOLBAR, GroupsScreen } from "@/features/people/groups-screen.tsx";
import { MEMBERS_TOOLBAR, MembersScreen } from "@/features/people/members-screen.tsx";
import { BINDINGS_TOOLBAR, BindingsScreen } from "@/features/sources/bindings-screen.tsx";
import { createApiProxy, type ApiProxy } from "@/shared/api/trpc.ts";
import {
  CONSOLE,
  hides,
  HOMES,
  leadsTo,
  movedWithin,
  SURFACES,
  visibleTo,
  type Moved,
  type Reader,
  type Screen,
  type ScreenPath,
  type Surface,
} from "@/shared/navigation.ts";
import type { ScreenToolbar } from "@/shared/screen-toolbar.tsx";

import { ConsoleFrame } from "./console-frame.tsx";
import { FailedScreen } from "./failed-screen.tsx";
import { WorkspaceFrame } from "./frame.tsx";
import type { AppClients } from "./providers.tsx";
import {
  ROUTES_AND_SPEND_TOOLBAR,
  RoutesAndSpendScreen,
} from "./screens/routes-and-spend-screen.tsx";
import { UnbuiltScreen } from "./screens/unbuilt-screen.tsx";
import { UnknownScreen } from "./unknown-screen.tsx";
import { useHiddenOnArrival, useVisibleTree } from "./visible-tree.ts";
import { ROLE_UNREAD } from "./words.ts";

type BuiltScreen = { readonly draw: () => ReactElement; readonly toolbar?: ScreenToolbar };

const BUILT: readonly (readonly [ScreenPath, BuiltScreen])[] = [
  ["/sources/bindings", { draw: BindingsScreen, toolbar: BINDINGS_TOOLBAR }],
  [
    "/agent-operations/routes-and-spend",
    { draw: RoutesAndSpendScreen, toolbar: ROUTES_AND_SPEND_TOOLBAR },
  ],
  ["/people/members", { draw: MembersScreen, toolbar: MEMBERS_TOOLBAR }],
  ["/people/groups", { draw: GroupsScreen, toolbar: GROUPS_TOOLBAR }],
  ["/system/audit-log", { draw: AuditLogScreen, toolbar: AUDIT_LOG_TOOLBAR }],
  ["/console/people/everyone", { draw: EveryoneScreen, toolbar: EVERYONE_TOOLBAR }],
  ["/console/people/names-waiting", { draw: NamesWaitingScreen, toolbar: NAMES_WAITING_TOOLBAR }],
  ["/console/workspaces/every-workspace", { draw: WorkspacesScreen }],
];

/** The list decides which screens are built; this map only says by what, and with what in hand. */
const BUILT_SCREENS: ReadonlyMap<string, BuiltScreen> = new Map(BUILT);

type ShellContext = { readonly queryClient: QueryClient; readonly api: ApiProxy };

const rootRoute = createRootRouteWithContext<ShellContext>()({
  component: Outlet,
  notFoundComponent: () => <UnknownScreen />,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInScreen,
});

const displayNameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/display-name",
  component: DisplayNameScreen,
  beforeLoad: async ({ context }) => {
    const elsewhere = await displayNameDetour(context.queryClient, pageQuery());
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
  },
});

const chooseWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/choose-workspace",
  component: ChooseWorkspaceScreen,
});

const noWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/no-workspace",
  component: NoWorkspaceScreen,
});

/** Outside the shell: the person joining holds no membership of the workspace yet. */
const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invitations/$invitationId",
  component: function AcceptInvitationPage(): ReactElement {
    const { invitationId } = acceptInvitationRoute.useParams();
    return <AcceptInvitationScreen invitationId={invitationId} />;
  },
  beforeLoad: async ({ context, location }) => {
    const elsewhere = await acceptDetour(context.queryClient, location.pathname);
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
  },
});

const signInAndBackTo = (href: string) => ({ href: backTo("/sign-in", href), replace: true });

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: WorkspaceFrame,
  notFoundComponent: () => <UnknownScreen />,
  // The sign-in screen and the picker are this route's siblings, so this never runs on them.
  beforeLoad: async ({ context, location }) => {
    const refusal = await membershipRefusal(context.queryClient, context.api);
    if (refusal === undefined) return;

    throw redirect(
      refusal === NEEDS_A_PICK
        ? { href: "/choose-workspace", replace: true }
        : signInAndBackTo(location.href),
    );
  },
});

/** Read after the shell's own read, which left no role in hand when it failed. */
const memberOf = (context: ShellContext): Reader => ({
  role: roleHeld(context.queryClient, context.api),
  owns: [],
});

/** No role is held, so asking again is the one way on; the route moves once it answers. */
function RoleUnread() {
  const membership = useMembership();

  return (
    <FailedScreen
      reset={() => {
        void membership.refetch();
      }}
      said={ROLE_UNREAD}
    />
  );
}

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  beforeLoad: ({ context }) => {
    const { role } = memberOf(context);
    if (role !== undefined) throw redirect({ href: HOMES[role].path, replace: true });
  },
  component: function HomeUnread() {
    const { home } = useVisibleTree();
    return home === undefined ? <RoleUnread /> : <Navigate to={home.path} replace />;
  },
});

/** Outside any workspace, so it asks for a session and never for a workspace pick. */
const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "console",
  component: ConsoleFrame,
  notFoundComponent: () => <UnknownScreen home={HOMES.operator} />,
  // Asked afresh on the way in, and not again on each move between the console's own screens.
  beforeLoad: async ({ context, location, cause }) => {
    if (await mustSignInForTheConsole(context.queryClient, context.api, cause === "enter")) {
      throw redirect(signInAndBackTo(location.href));
    }
  },
});

const consoleIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/console",
  beforeLoad: () => {
    throw redirect({ href: HOMES.operator.path, replace: true });
  },
});

/** A screen hidden from a held role draws as an address that never existed. */
function Seen(properties: { readonly draw: () => ReactElement }) {
  if (useHiddenOnArrival()) return <UnknownScreen />;

  const Draw = properties.draw;
  return <Draw />;
}

/** An older address moves on only once the reader may see where it leads. */
function MovedAway(properties: { readonly moved: Moved }) {
  const visible = useVisibleTree();
  if (visible.home === undefined) return <RoleUnread />;

  const to = leadsTo(visible, properties.moved);
  return to === undefined ? <UnknownScreen /> : <Navigate to={to.path} replace />;
}

const drawOf = (screen: Screen, isAHome: boolean): (() => ReactElement) | undefined => {
  const built = BUILT_SCREENS.get(screen.path);
  if (screen.built && built === undefined) {
    throw new Error(`the list calls ${screen.path} built, and nothing draws it`);
  }
  if (!screen.built && built !== undefined) {
    throw new Error(`the list calls ${screen.path} unbuilt, and something draws it`);
  }
  return built?.draw ?? (isAHome ? () => <UnbuiltScreen home={screen} /> : undefined);
};

/** A failed screen offers the way home, which in the console is the console's own. */
const routesOf = (
  surfaces: readonly Surface[],
  shell: AnyRoute,
  readerOf: (context: ShellContext) => Reader,
  home?: Screen,
): AnyRoute[] => {
  const failed = (failure: { readonly reset: () => void }) => (
    <FailedScreen reset={failure.reset} home={home} />
  );
  const homes: readonly Screen[] = Object.values(HOMES);

  // An unbuilt screen has no route at all, so its address is one that never existed.
  const screens = surfaces.flatMap((surface) => [
    ...(surface.home === undefined ? [] : [surface.home]),
    ...surface.groups.flatMap((group) => group.screens),
  ]);
  const drawn = screens.flatMap((screen) => {
    const draw = drawOf(screen, homes.includes(screen));
    return draw === undefined ? [] : [{ screen, draw }];
  });

  return [
    ...drawn.map(({ screen, draw }) =>
      createRoute({
        getParentRoute: () => shell,
        path: screen.path,
        beforeLoad: ({ context }) => ({
          hidden: hides(visibleTo(readerOf(context), surfaces), screen.path),
        }),
        component: () => <Seen draw={draw} />,
        errorComponent: failed,
        staticData: { toolbar: BUILT_SCREENS.get(screen.path)?.toolbar },
      }),
    ),
    ...movedWithin(surfaces).map((moved) =>
      createRoute({
        getParentRoute: () => shell,
        path: moved.from,
        beforeLoad: ({ context }) => {
          const to = leadsTo(visibleTo(readerOf(context), surfaces), moved);
          if (to !== undefined) throw redirect({ href: to.path, replace: true });
        },
        component: () => <MovedAway moved={moved} />,
      }),
    ),
  ];
};

const workspaceRoutes = routesOf(SURFACES, shellRoute, memberOf);

const consoleRoutes = routesOf(
  [CONSOLE],
  consoleRoute,
  () => ({ role: "operator", owns: [] }),
  HOMES.operator,
);

export const createAppRouter = (clients: AppClients, history?: RouterHistory) => {
  const options = {
    routeTree: rootRoute.addChildren([
      signInRoute,
      displayNameRoute,
      chooseWorkspaceRoute,
      noWorkspaceRoute,
      acceptInvitationRoute,
      shellRoute.addChildren([indexRoute, ...workspaceRoutes]),
      consoleRoute.addChildren([consoleIndexRoute, ...consoleRoutes]),
    ]),

    context: {
      queryClient: clients.queryClient,
      api: createApiProxy(clients.apiClient, clients.queryClient),
    },
    defaultErrorComponent: FailedScreen,
  };

  return history === undefined ? createRouter(options) : createRouter({ ...options, history });
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }

  /** The route is how a screen's toolbar reaches the shell: props down, never an import up. */
  interface StaticDataRouteOption {
    readonly toolbar?: ScreenToolbar | undefined;
  }
}
