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

import { AuthConfiguration } from "@/features/auth/auth-configuration.tsx";
import { ChooseWorkspaceScreen } from "@/features/auth/choose-workspace-screen.tsx";
import { NoWorkspaceScreen } from "@/features/auth/no-workspace-screen.tsx";
import { SignInScreen } from "@/features/auth/sign-in-screen.tsx";
import { SCREENS, type Screen, type ScreenId } from "@/shared/screens.ts";
import { Frame } from "./frame.tsx";
import { SystemScreen } from "./screens/system-screen.tsx";
import { UnbuiltScreen } from "./screens/unbuilt-screen.tsx";
import { UnknownScreen } from "./unknown-screen.tsx";

/**
 * The router. Routes are declared in code rather than generated from a file tree, because
 * the six screens are one list (`shared/screens.ts`) that the navigation reads too, and a
 * generated tree would put the same six names in a second place.
 *
 * The api serves this shell for any address on `app.` it does not answer itself (ADR 0006,
 * amended 2026-09-02), so an address that is not a screen reaches the router rather than
 * the authorization server's 404; `notFoundComponent` is what answers it.
 *
 * Two levels below the root, because the product has two kinds of address. The **shell**
 * carries Control Centre's frame and everything a member of a workspace reads. The three
 * screens beside it — sign-in, the picker, the refused screen — stand outside it: a person
 * reading one of them has no workspace yet, and a frame around them would offer six
 * screens that would all refuse (T-037).
 */

/**
 * The screens with something behind them. Everything else in `SCREENS` renders the unbuilt
 * screen, so a screen becomes built by being added here and in no other place.
 */
const BUILT_SCREENS = new Map<ScreenId, () => ReactElement>([["system", SystemScreen]]);

/**
 * better-auth-ui's configuration sits here rather than above the router, because two of
 * the three things it needs are the router's own: how to navigate, and how to render a
 * link.
 */
const rootRoute = createRootRoute({
  component: () => (
    <AuthConfiguration>
      <Outlet />
    </AuthConfiguration>
  ),
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

/** The shell: a route with no address of its own, so every screen under it wears the frame. */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: Frame,
  notFoundComponent: UnknownScreen,
});

// Control Centre has no home of its own: the frame's first screen is System, and `/`
// carries the reader there rather than rendering a page that exists only to be left.
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

/**
 * The history is a parameter because a test drives the router without a browser: assigning
 * one after construction relies on the router re-reading a property it never promised to.
 */
export const createAppRouter = (history?: RouterHistory) =>
  createRouter({
    routeTree: rootRoute.addChildren([
      signInRoute,
      chooseWorkspaceRoute,
      noWorkspaceRoute,
      shellRoute.addChildren([indexRoute, ...screenRoutes]),
    ]),
    ...(history === undefined ? {} : { history }),
  });

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
