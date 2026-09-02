import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRoute,
} from "@tanstack/react-router";
import type { ReactElement } from "react";

import { SystemScreen } from "../screens/system-screen.tsx";
import { UnbuiltScreen } from "../screens/unbuilt-screen.tsx";
import { SCREENS, type Screen, type ScreenId } from "../shared/screens.ts";
import { Frame } from "./frame.tsx";
import { UnknownScreen } from "./unknown-screen.tsx";

/**
 * The router. Routes are declared in code rather than generated from a file tree, because
 * the six screens are one list (`shared/screens.ts`) that the navigation reads too, and a
 * generated tree would put the same six names in a second place.
 *
 * The api serves this shell for any address on `app.` it does not answer itself (ADR 0006,
 * amended 2026-09-02), so an address that is not a screen reaches the router rather than
 * the authorization server's 404; `notFoundComponent` is what answers it.
 */

/**
 * The screens with something behind them. Everything else in `SCREENS` renders the unbuilt
 * screen, so a screen becomes built by being added here and in no other place.
 */
const BUILT_SCREENS = new Map<ScreenId, () => ReactElement>([["system", SystemScreen]]);

const rootRoute = createRootRoute({
  component: Frame,
  notFoundComponent: UnknownScreen,
});

// Control Centre has no home of its own: the frame's first screen is System, and `/`
// carries the reader there rather than rendering a page that exists only to be left.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/system", replace: true });
  },
});

const componentFor = (screen: Screen): (() => ReactElement) =>
  BUILT_SCREENS.get(screen.id) ?? (() => <UnbuiltScreen screen={screen} />);

const screenRoutes: AnyRoute[] = SCREENS.map((screen) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: screen.path,
    component: componentFor(screen),
  }),
);

export const createAppRouter = () =>
  createRouter({ routeTree: rootRoute.addChildren([indexRoute, ...screenRoutes]) });

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
