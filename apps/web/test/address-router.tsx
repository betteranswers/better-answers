import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type RouteComponent,
} from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { expect } from "vitest";

type Wrapper = ComponentType<{ readonly children: ReactNode }>;

/** Each page at its path in a router of its own, opened at the last of `entries`. */
export const openPages = async (
  pages: Readonly<Record<string, RouteComponent>>,
  entries: readonly string[],
  wrapper?: Wrapper,
) => {
  const root = createRootRoute();
  const routeTree = root.addChildren(
    Object.entries(pages).map(([path, component]) =>
      createRoute({ getParentRoute: () => root, path, component }),
    ),
  );
  const history = createMemoryHistory({
    initialEntries: [...entries],
    initialIndex: entries.length - 1,
  });
  const router = createRouter({ routeTree, history });
  await router.load();
  render(<RouterProvider router={router} />, { wrapper });
  const at = (href: string) => waitFor(() => expect(router.state.location.href).toBe(href));
  return { router, history, at };
};
