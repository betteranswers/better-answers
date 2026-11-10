import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { Frame } from "@/app/shell/frame.tsx";
import type { IconName } from "@/shared/icon.tsx";
import type { Page, VisibleTree } from "@/shared/navigation.ts";
import { ASK, menuGroupIn, pageById } from "@/shared/navigation.ts";

const aPage = (name: string, path: Page["path"], icon: IconName): Page => ({
  id: name.toLowerCase(),
  name,
  path,
  icon,
  built: true,
  seenBy: ["Admin"],
});

const QUESTIONS = aPage(
  pageById(menuGroupIn(ASK, "ask"), "your-questions").name,
  "/first/your-questions",
  "question",
);

const GUIDES = aPage("Guides", "/second/guides", "guides");

const TYPES = aPage("Types", "/second/types", "types");

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
      menuGroups: [{ id: "reading", name: "Reading", pages: [GUIDES, TYPES] }],
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
  const pages = [QUESTIONS, GUIDES, TYPES].map((each) =>
    createRoute({
      getParentRoute: () => root,
      path: each.path,
      component: () => <p>{each.name} page</p>,
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

const railLinks = () =>
  within(screen.getByRole("navigation", { name: "Areas" })).getAllByRole("link");

const visibleTooltips = () => screen.queryAllByRole("tooltip").map((each) => each.textContent);

/** The popper measures its arrow, which jsdom cannot. */
const NoopResizeObserver = class {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a rail of two areas", () => {
  it("shows one tooltip at a time across its links", async () => {
    await openAt(QUESTIONS.path);
    const [first, second] = railLinks();
    assert(first !== undefined, "the rail has no first area link");
    assert(second !== undefined, "the rail has no second area link");

    act(() => first.focus());
    expect(await screen.findByRole("tooltip")).toBeDefined();
    expect(visibleTooltips()).toEqual(["First"]);

    fireEvent.pointerMove(second, { pointerType: "mouse" });
    await vi.waitFor(() => expect(visibleTooltips()).toEqual(["Second"]));
    expect(document.activeElement).toBe(first);
  });

  it("swaps the menu when another area is chosen", async () => {
    await openAt(QUESTIONS.path);
    expect(screen.getByRole("navigation", { name: "First" })).toBeDefined();

    const second = railLinks()[1];
    assert(second !== undefined, "the rail has no second area link");
    fireEvent.click(second);

    const swapped = await screen.findByRole("navigation", { name: "Second" });
    expect(
      within(swapped)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Guides", "Types"]);
    expect(within(swapped).getByRole("link", { current: "page" }).textContent).toBe("Guides");
    expect(screen.queryByRole("navigation", { name: "First" })).toBeNull();
    expect(second.getAttribute("aria-current")).toBe("page");
  });
});
