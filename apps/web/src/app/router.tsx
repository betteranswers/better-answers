import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type AnyRoute,
  type RouterHistory,
} from "@tanstack/react-router";
import type { ReactElement } from "react";

import { ChooseWorkspaceScreen } from "@/features/auth/choose-workspace-screen.tsx";
import { NoWorkspaceScreen } from "@/features/auth/no-workspace-screen.tsx";
import { SignInScreen } from "@/features/auth/sign-in-screen.tsx";
import { SCREENS, viewsOf, type Screen, type View } from "@/shared/screens.ts";
import { FailedScreen } from "./failed-screen.tsx";
import { Frame } from "./frame.tsx";
import type { ViewToolbar } from "./toolbar.tsx";
import { UnknownScreen } from "./unknown-screen.tsx";
import { ROUTES_AND_SPEND_TOOLBAR, RoutesAndSpendView } from "./views/routes-and-spend-view.tsx";
import { UnbuiltView } from "./views/unbuilt-view.tsx";

type BuiltView = { readonly draw: () => ReactElement; readonly toolbar?: ViewToolbar };

// The list decides which views are built; this map only says by what, and with what in hand.
const BUILT_VIEWS = new Map<View["path"], BuiltView>([
  ["/system/routes-and-spend", { draw: RoutesAndSpendView, toolbar: ROUTES_AND_SPEND_TOOLBAR }],
]);

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: UnknownScreen,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInScreen,
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

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: Frame,
  notFoundComponent: UnknownScreen,
});

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/system", replace: true });
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

const screenRoutes: AnyRoute[] = SCREENS.map((screen) =>
  createRoute({
    getParentRoute: () => shellRoute,
    path: screen.path,
    beforeLoad: () => {
      throw redirect({ href: screen.defaultView, replace: true });
    },
  }),
);

const viewRoutes: AnyRoute[] = SCREENS.flatMap((screen) =>
  viewsOf(screen).map((view) =>
    createRoute({
      getParentRoute: () => shellRoute,
      path: view.path,
      component: componentFor(screen, view),
      staticData: { toolbar: BUILT_VIEWS.get(view.path)?.toolbar },
    }),
  ),
);

export const createAppRouter = (history?: RouterHistory) => {
  const options = {
    routeTree: rootRoute.addChildren([
      signInRoute,
      chooseWorkspaceRoute,
      noWorkspaceRoute,
      shellRoute.addChildren([indexRoute, ...screenRoutes, ...viewRoutes]),
    ]),

    defaultErrorComponent: FailedScreen,
  };

  return history === undefined ? createRouter(options) : createRouter({ ...options, history });
};

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }

  // The route is how a view's toolbar reaches the shell: props down, never an import up.
  interface StaticDataRouteOption {
    readonly toolbar?: ViewToolbar | undefined;
  }
}
