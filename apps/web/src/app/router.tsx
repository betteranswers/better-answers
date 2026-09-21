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
import { SCREENS, type Screen, type ScreenId } from "@/shared/screens.ts";
import { FailedScreen } from "./failed-screen.tsx";
import { Frame } from "./frame.tsx";
import { SystemScreen } from "./screens/system-screen.tsx";
import { UnbuiltScreen } from "./screens/unbuilt-screen.tsx";
import { UnknownScreen } from "./unknown-screen.tsx";

const BUILT_SCREENS = new Map<ScreenId, () => ReactElement>([["system", SystemScreen]]);

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

const componentFor = (screen: Screen): (() => ReactElement) =>
  BUILT_SCREENS.get(screen.id) ?? (() => <UnbuiltScreen screen={screen} />);

const screenRoutes: AnyRoute[] = SCREENS.map((screen) =>
  createRoute({
    getParentRoute: () => shellRoute,
    path: screen.path,
    component: componentFor(screen),
  }),
);

export const createAppRouter = (history?: RouterHistory) => {
  const options = {
    routeTree: rootRoute.addChildren([
      signInRoute,
      chooseWorkspaceRoute,
      noWorkspaceRoute,
      shellRoute.addChildren([indexRoute, ...screenRoutes]),
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
}
