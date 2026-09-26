import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
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
import { membershipRefusal, NEEDS_A_PICK } from "@/features/auth/membership.ts";
import { NoWorkspaceScreen } from "@/features/auth/no-workspace-screen.tsx";
import { SignInScreen } from "@/features/auth/sign-in-screen.tsx";
import { EVERYONE_TOOLBAR, EveryoneView } from "@/features/console/everyone-view.tsx";
import { mustSignInForTheConsole } from "@/features/console/operator.ts";
import { WorkspacesView } from "@/features/console/workspaces-view.tsx";
import { AUDIT_LOG_TOOLBAR, AuditLogView } from "@/features/people/audit-log-view.tsx";
import { GROUPS_TOOLBAR, GroupsView } from "@/features/people/groups-view.tsx";
import { MEMBERS_TOOLBAR, MembersView } from "@/features/people/members-view.tsx";
import { BINDINGS_TOOLBAR, BindingsView } from "@/features/sources/bindings-view.tsx";
import { createApiProxy, type ApiProxy } from "@/shared/api/trpc.ts";
import {
  CONSOLE,
  CONTROL_CENTRE,
  viewsOf,
  type Screen,
  type Surface,
  type View,
} from "@/shared/screens.ts";
import type { ViewToolbar } from "@/shared/view-toolbar.tsx";
import { ConsoleFrame } from "./console-frame.tsx";
import { FailedScreen } from "./failed-screen.tsx";
import { ControlCentreFrame } from "./frame.tsx";
import type { AppClients } from "./providers.tsx";
import { UnknownScreen } from "./unknown-screen.tsx";
import { ROUTES_AND_SPEND_TOOLBAR, RoutesAndSpendView } from "./views/routes-and-spend-view.tsx";
import { UnbuiltView } from "./views/unbuilt-view.tsx";

type BuiltView = { readonly draw: () => ReactElement; readonly toolbar?: ViewToolbar };

/** The list decides which views are built; this map only says by what, and with what in hand. */
const BUILT_VIEWS = new Map<View["path"], BuiltView>([
  ["/sources/bindings", { draw: BindingsView, toolbar: BINDINGS_TOOLBAR }],
  ["/people/members", { draw: MembersView, toolbar: MEMBERS_TOOLBAR }],
  ["/people/groups", { draw: GroupsView, toolbar: GROUPS_TOOLBAR }],
  ["/people/audit-log", { draw: AuditLogView, toolbar: AUDIT_LOG_TOOLBAR }],
  ["/system/routes-and-spend", { draw: RoutesAndSpendView, toolbar: ROUTES_AND_SPEND_TOOLBAR }],
  ["/console/people/everyone", { draw: EveryoneView, toolbar: EVERYONE_TOOLBAR }],
  ["/console/workspaces/every-workspace", { draw: WorkspacesView }],
]);

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
  component: ControlCentreFrame,
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

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ href: CONTROL_CENTRE.home.path, replace: true });
  },
});

/** Outside any workspace, so it asks for a session and never for a workspace pick. */
const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "console",
  component: ConsoleFrame,
  notFoundComponent: () => <UnknownScreen surface={CONSOLE} />,
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
    throw redirect({ href: CONSOLE.home.path, replace: true });
  },
});

const componentFor = (screen: Screen, view: View): (() => ReactElement) => {
  const built = BUILT_VIEWS.get(view.path);
  if (view.built && built === undefined) {
    throw new Error(`the list calls ${view.path} built, and nothing draws it`);
  }
  if (!view.built && built !== undefined) {
    throw new Error(`the list calls ${view.path} unbuilt, and something draws it`);
  }
  return built?.draw ?? (() => <UnbuiltView screen={screen} view={view} />);
};

/** A failed view names its own surface and its way home, so the view carries the failure screen. */
const routesOf = (surface: Surface, shell: AnyRoute): AnyRoute[] => {
  const failed = (failure: { readonly reset: () => void }) => (
    <FailedScreen reset={failure.reset} surface={surface} />
  );
  return surface.screens.flatMap((screen) => [
    createRoute({
      getParentRoute: () => shell,
      path: screen.path,
      beforeLoad: () => {
        throw redirect({ href: screen.defaultView, replace: true });
      },
    }),
    ...viewsOf(screen).map((view) =>
      createRoute({
        getParentRoute: () => shell,
        path: view.path,
        component: componentFor(screen, view),
        errorComponent: failed,
        staticData: { toolbar: BUILT_VIEWS.get(view.path)?.toolbar },
      }),
    ),
  ]);
};

const controlCentreRoutes = routesOf(CONTROL_CENTRE, shellRoute);

const consoleRoutes = routesOf(CONSOLE, consoleRoute);

export const createAppRouter = (clients: AppClients, history?: RouterHistory) => {
  const options = {
    routeTree: rootRoute.addChildren([
      signInRoute,
      displayNameRoute,
      chooseWorkspaceRoute,
      noWorkspaceRoute,
      acceptInvitationRoute,
      shellRoute.addChildren([indexRoute, ...controlCentreRoutes]),
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

  /** The route is how a view's toolbar reaches the shell: props down, never an import up. */
  interface StaticDataRouteOption {
    readonly toolbar?: ViewToolbar | undefined;
  }
}
