import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useAsked } from "@/shared/address-ask.ts";

afterEach(cleanup);

/** Keeps each search in its own state, the one place `take` may write during render. */
const Members = () => {
  const [taken, setTaken] = useState<readonly string[]>([]);
  useAsked("search", (value) => setTaken((before) => [...before, value]));
  return <output>{taken.join(" ")}</output>;
};

const takenSoFar = () => screen.getByRole("status").textContent;

const openAt = async (...entries: readonly string[]) => {
  const root = createRootRoute();
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/members", component: Members }),
    createRoute({ getParentRoute: () => root, path: "/elsewhere", component: () => null }),
  ]);
  const history = createMemoryHistory({
    initialEntries: [...entries],
    initialIndex: entries.length - 1,
  });
  const router = createRouter({ routeTree, history });
  await router.load();
  render(<RouterProvider router={router} />);
  const at = (href: string) => waitFor(() => expect(router.state.location.href).toBe(href));
  return { router, history, at };
};

describe("a search another place asks of a screen", () => {
  it("is taken once, then cleared from the address in place", async () => {
    const { history, at } = await openAt("/elsewhere", "/members?search=priya");

    await at("/members");
    expect(takenSoFar()).toBe("priya");
    expect(history.length, "the clear pushed an entry of its own").toBe(2);
  });

  it("is never asked again by a step back and forward", async () => {
    const { history, at } = await openAt("/elsewhere", "/members?search=priya");
    await at("/members");

    act(() => history.back());
    await at("/elsewhere");
    act(() => history.forward());
    await at("/members");

    expect(takenSoFar(), "the screen took an ask on its way back").toBe("");
  });

  it("is taken by a screen already open", async () => {
    const { router, at } = await openAt("/members?search=priya");
    await at("/members");

    await act(() => router.navigate({ href: "/members?search=tom" }));
    await at("/members");

    expect(takenSoFar()).toBe("priya tom");
  });
});
