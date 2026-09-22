import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { SCREENS, viewsOf } from "@/shared/screens.ts";

import { appAt, openApp } from "./open-app.tsx";

afterEach(cleanup);

const openAt = async (path: string) => (await openApp(path)).rendered;

const rail = () => screen.getByRole("navigation", { name: "Control Centre" });

const secondaryNav = (screenName: string) => screen.getByRole("navigation", { name: screenName });

describe("Control Centre's three-region shell", () => {
  it("names all six screens in the icon rail, in the glossary's order", async () => {
    await openAt("/system");

    const named = within(rail())
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(named).toEqual(SCREENS.map((each) => each.name));
  });

  it("carries the four regions as landmarks and a skip link as the first thing in the order", async () => {
    const { container } = await openAt("/system");

    expect(rail()).toBeDefined();
    expect(secondaryNav("System")).toBeDefined();
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();

    const first = container.querySelector("a");
    expect(first?.textContent).toBe("Skip to the screen");
    expect(first?.getAttribute("href")).toBe(`#${screen.getByRole("main").id}`);
  });

  it("lists the open screen's views in the secondary nav, under that screen's name", async () => {
    await openAt("/system/health");

    const listed = within(secondaryNav("System"))
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(listed).toEqual(["Signals", "Health", "Routes and spend", "Backups"]);
    expect(within(secondaryNav("System")).getByRole("heading", { level: 2 }).textContent).toBe(
      "System",
    );
  });

  it("swaps the secondary nav to the new screen's views, never showing another screen's", async () => {
    const { unmount } = await openAt("/people/owners");
    expect(
      within(secondaryNav("People"))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Roles", "Owners", "Thresholds", "Erasure and suppression", "Tokens"]);
    expect(screen.queryByRole("navigation", { name: "System" })).toBeNull();
    unmount();

    await openAt("/questions/promotions");
    expect(
      within(secondaryNav("Questions"))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Answer audit", "Promotions", "Answer tests"]);
    expect(screen.queryByRole("navigation", { name: "People" })).toBeNull();
  });

  it("marks the open screen in the rail and the open view in the secondary nav", async () => {
    await openAt("/people/thresholds");

    const marked = within(rail())
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"))
      .map((link) => link.textContent);
    expect(marked).toEqual(["People"]);

    const current = within(secondaryNav("People")).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Thresholds");
  });

  it("names the workspace, then where the person is, then who they are, once it knows", async () => {
    await openAt("/system/routes-and-spend");

    const bar = screen.getByRole("banner");
    expect(within(bar).getByText("System", { exact: false })).toBeDefined();
    expect(within(bar).getByText("Routes and spend", { exact: false })).toBeDefined();
  });

  it("says nothing about the person until it knows it, rather than guessing", async () => {
    const { container } = await openAt("/system");

    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(container.textContent).not.toMatch(/sign out/i);
  });

  it("says the five screens nobody has built are unbuilt, and does not say it of System", async () => {
    const unbuilt: string[] = [];
    for (const each of SCREENS) {
      const { unmount } = await openAt(each.path);
      if (screen.queryByText("This view is not built yet.") !== null) unbuilt.push(each.name);
      unmount();
    }

    expect(unbuilt).toEqual(["Sources", "Suggestions", "Knowledge", "Questions", "People"]);
  });

  it("gives System the routes card, and says the rest of the screen is unbuilt", async () => {
    await openAt("/system");

    expect(screen.getByRole("heading", { level: 2, name: "Routes" })).toBeDefined();

    expect(screen.getByText(/The rest of System/)).toBeDefined();
  });

  it("carries an address that is no screen and no view to a screen that says so", async () => {
    await openAt("/not-a-screen");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No such screen");
  });

  it("keeps the regions on an address under a screen that names no such view, and says so", async () => {
    await openAt("/system/not-a-view");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No such screen");
    expect(rail()).toBeDefined();
    expect(secondaryNav("System")).toBeDefined();
    expect(screen.getByRole("banner")).toBeDefined();
  });
});

// One direction finds the view the router forgot; only the other finds the route nothing declared.
const declaredViewPaths = (): readonly string[] =>
  SCREENS.flatMap((each) => viewsOf(each).map((view) => view.path));

const routedViewPaths = (): readonly string[] => {
  const router = createAppRouter(
    createAppClients(),
    createMemoryHistory({ initialEntries: ["/system"] }),
  );
  return Object.keys(router.routesByPath).filter((path) =>
    SCREENS.some((each) => path.startsWith(`${each.path}/`)),
  );
};

const navigatedViewPaths = async (): Promise<readonly string[]> => {
  const reached: string[] = [];
  for (const each of SCREENS) {
    const { unmount } = await openAt(each.defaultView);
    for (const link of within(secondaryNav(each.name)).getAllByRole("link")) {
      reached.push(link.getAttribute("href") ?? "");
    }
    unmount();
  }
  return reached;
};

describe("Control Centre's one list of screens and their views", () => {
  it("declares each screen's views in the glossary's words and in its order", () => {
    expect(SCREENS.map((each) => [each.name, viewsOf(each).map((view) => view.name)])).toEqual([
      [
        "Sources",
        [
          "Bindings",
          "Publish and accept gates",
          "Priced plan",
          "Backlogs",
          "Gone-at-source impact",
          "Agent tokens",
          "Ceiling",
        ],
      ],
      ["Suggestions", ["Queue"]],
      ["Knowledge", ["Review table", "Conflicts and verification requests", "Exports"]],
      ["Questions", ["Answer audit", "Promotions", "Answer tests"]],
      ["People", ["Roles", "Owners", "Thresholds", "Erasure and suppression", "Tokens"]],
      ["System", ["Signals", "Health", "Routes and spend", "Backups"]],
    ]);
  });

  it("names for each screen the address its own address leads to", () => {
    expect(SCREENS.map((each) => [each.path, each.defaultView])).toEqual([
      ["/sources", "/sources/bindings"],
      ["/suggestions", "/suggestions/queue"],
      ["/knowledge", "/knowledge/review-table"],
      ["/questions", "/questions/answer-audit"],
      ["/people", "/people/roles"],
      ["/system", "/system/routes-and-spend"],
    ]);
  });

  it("calls one view built — the routes list System's own address reaches — and the rest not", () => {
    const built = SCREENS.flatMap((each) =>
      viewsOf(each)
        .filter((view) => view.built)
        .map((view) => view.path),
    );

    expect(built).toEqual(["/system/routes-and-spend"]);
  });

  it("gives every view on the list a route of its own", () => {
    const routed = routedViewPaths();

    expect(declaredViewPaths().filter((path) => !routed.includes(path))).toEqual([]);
  });

  it("routes nothing under a screen that the list does not declare a view", () => {
    const declared = declaredViewPaths();

    expect(routedViewPaths().filter((path) => !declared.includes(path))).toEqual([]);
  });

  it("gives every view on the list an entry in its screen's secondary nav", async () => {
    const reached = await navigatedViewPaths();

    expect(declaredViewPaths().filter((path) => !reached.includes(path))).toEqual([]);
  });

  it("lists nothing in a secondary nav that the list does not declare a view", async () => {
    const declared = declaredViewPaths();

    expect((await navigatedViewPaths()).filter((path) => !declared.includes(path))).toEqual([]);
  });

  it("gives each screen a glyph of its own, so no two rail entries draw the same one", () => {
    expect(new Set(SCREENS.map((each) => each.icon)).size).toBe(SCREENS.length);
  });

  it("names as each screen's default an address that screen declares a view", () => {
    const strangers = SCREENS.filter(
      (each) => !viewsOf(each).some((view) => view.path === each.defaultView),
    ).map((each) => each.name);

    expect(strangers).toEqual([]);
  });

  it("lands a screen's own address on that screen's default view", async () => {
    const landed: string[] = [];
    for (const each of SCREENS) {
      const { router } = await appAt(each.path);
      landed.push(router.state.location.pathname);
    }

    expect(landed).toEqual([
      "/sources/bindings",
      "/suggestions/queue",
      "/knowledge/review-table",
      "/questions/answer-audit",
      "/people/roles",
      "/system/routes-and-spend",
    ]);
  });

  it("opens every view at its own address, saying it is not built where the list says it is not", async () => {
    for (const each of SCREENS) {
      for (const view of viewsOf(each)) {
        const { unmount } = await openAt(view.path);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(each.name);
        expect(screen.queryByText("This view is not built yet.") === null).toBe(view.built);
        unmount();
      }
    }
  });
});
