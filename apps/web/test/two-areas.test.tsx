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
import type { Page, VisibleTree } from "@/shared/navigation.ts";

/** No role reaches two areas yet, so the shell is handed a tree that does. */
const aPage = (name: string, path: string, icon: IconName): Page => ({
  name,
  path,
  icon,
  built: true,
  seenBy: ["Admin"],
});

const QUESTIONS = aPage("Your questions", "/first/your-questions", "question");

const GUIDES = aPage("Guides", "/second/guides", "guides");

const KINDS = aPage("Kinds", "/second/kinds", "kinds");

const TWO_AREAS: VisibleTree = {
  home: QUESTIONS,
  areas: [
    {
      id: "first",
      name: "First",
      icon: "ask",
      menuGroups: [{ id: "first", pages: [QUESTIONS] }],
      opensAt: QUESTIONS,
    },
    {
      id: "second",
      name: "Second",
      icon: "map",
      menuGroups: [{ id: "reading", name: "Reading", pages: [GUIDES, KINDS] }],
      opensAt: GUIDES,
    },
  ],
};

const openAt = async (path: string) => {
  const root = createRootRoute({
    component: () => (
      <Frame
        visible={TWO_AREAS}
        here={{ name: "Holme Valley Tools", workspaceId: "w" }}
        person={{ name: "Ada", role: "Admin" }}
        offersTheConsole={false}
      />
    ),
  });
  const pages = [QUESTIONS, GUIDES, KINDS].map((each) =>
    createRoute({
      getParentRoute: () => root,
      path: each.path,
      component: () => <p>{each.name} drew.</p>,
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren(pages),
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

describe("a rail of two areas", () => {
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

  it("swaps the menu when another area is chosen", async () => {
    await openAt(QUESTIONS.path);
    expect(screen.getByRole("navigation", { name: "First" })).toBeDefined();

    const second = railLinks()[1];
    if (second === undefined) throw new Error("the rail lists no second area");
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
