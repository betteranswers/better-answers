import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Frame } from "@/app/frame.tsx";
import { createAppClients, Providers } from "@/app/providers.tsx";
import { RAIL } from "@/app/words.ts";
import type { IconName } from "@/shared/icon.tsx";
import type { Screen, VisibleTree } from "@/shared/navigation.ts";

/** No role reaches two surfaces yet, so the shell is handed a tree that does. */
const aScreen = (name: string, path: string, icon: IconName): Screen => ({
  name,
  path,
  icon,
  built: true,
  seenBy: ["Admin"],
});

const QUESTIONS = aScreen("Your questions", "/first/your-questions", "question");

const GUIDES = aScreen("Guides", "/second/guides", "guides");

const KINDS = aScreen("Kinds", "/second/kinds", "kinds");

const TWO_SURFACES: VisibleTree = {
  home: QUESTIONS,
  surfaces: [
    {
      id: "first",
      name: "First",
      icon: "ask",
      groups: [{ id: "first", screens: [QUESTIONS] }],
      opensAt: QUESTIONS,
    },
    {
      id: "second",
      name: "Second",
      icon: "map",
      groups: [{ id: "reading", name: "Reading", screens: [GUIDES, KINDS] }],
      opensAt: GUIDES,
    },
  ],
};

const openAt = async (path: string) => {
  const root = createRootRoute({
    component: () => (
      <Frame
        visible={TWO_SURFACES}
        here={{ name: "Holme Valley Tools", workspaceId: "w" }}
        person={{ name: "Ada", role: "Admin" }}
        offersTheConsole={false}
      />
    ),
  });
  const screens = [QUESTIONS, GUIDES, KINDS].map((each) =>
    createRoute({
      getParentRoute: () => root,
      path: each.path,
      component: () => <p>{each.name} drew.</p>,
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren(screens),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <Providers clients={createAppClients()}>
      <RouterProvider router={router} />
    </Providers>,
  );
};

const railLinks = () => within(screen.getByRole("navigation", { name: RAIL })).getAllByRole("link");

const tooltipsShowing = () => screen.queryAllByRole("tooltip").map((each) => each.textContent);

/** The popper measures its arrow, which jsdom cannot. */
const measuresNothing = class {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", measuresNothing);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a rail of two surfaces", () => {
  it("opens one tooltip at a time across its entries", async () => {
    await openAt(QUESTIONS.path);
    const [first, second] = railLinks();
    if (first === undefined || second === undefined) throw new Error("the rail lists no two");

    act(() => first.focus());
    expect(await screen.findByRole("tooltip")).toBeDefined();
    expect(tooltipsShowing()).toEqual(["First"]);

    // The pointer moves on while the keyboard stays: the first gives way, not both at once.
    fireEvent.pointerMove(second, { pointerType: "mouse" });
    await vi.waitFor(() => expect(tooltipsShowing()).toEqual(["Second"]));
    expect(document.activeElement).toBe(first);
  });

  it("swaps the secondary nav when another surface is chosen", async () => {
    await openAt(QUESTIONS.path);
    expect(screen.getByRole("navigation", { name: "First" })).toBeDefined();

    const second = railLinks()[1];
    if (second === undefined) throw new Error("the rail lists no second surface");
    fireEvent.click(second);

    const swapped = await screen.findByRole("navigation", { name: "Second" });
    expect(
      within(swapped)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Guides", "Kinds"]);
    expect(within(swapped).getByRole("link", { current: "page" }).textContent).toBe("Guides");
    expect(screen.queryByRole("navigation", { name: "First" })).toBeNull();
    expect(second.getAttribute("aria-current")).toBe("page");
  });
});
