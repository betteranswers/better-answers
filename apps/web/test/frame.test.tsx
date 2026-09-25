import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import {
  CONSOLE,
  CONSOLE_SCREENS,
  CONTROL_CENTRE,
  SCREENS,
  viewsOf,
  type Screen,
} from "@/shared/screens.ts";

import { appAt, openApp } from "./open-app.tsx";

afterEach(cleanup);

const openAt = async (path: string) => (await openApp(path)).rendered;

const rail = () => screen.getByRole("navigation", { name: "Control Centre" });

const secondaryNav = (screenName: string) => screen.getByRole("navigation", { name: screenName });

describe("Control Centre's three-region shell", () => {
  it("names six screens in the icon rail, in glossary order", async () => {
    await openAt("/system");

    const named = within(rail())
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(named).toEqual(SCREENS.map((each) => each.name));
  });

  it("carries four landmark regions and a skip link first", async () => {
    const { container } = await openAt("/system");

    expect(rail()).toBeDefined();
    expect(secondaryNav("System")).toBeDefined();
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();

    const first = container.querySelector("a");
    expect(first?.textContent).toBe("Skip to the screen");
    expect(first?.getAttribute("href")).toBe(`#${screen.getByRole("main").id}`);
  });

  it("lists the open screen's views in the secondary nav", async () => {
    await openAt("/system/health");

    const listed = within(secondaryNav("System"))
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(listed).toEqual(["Signals", "Health", "Routes and spend", "Backups"]);
    expect(within(secondaryNav("System")).getByRole("heading", { level: 2 }).textContent).toBe(
      "System",
    );
  });

  it("swaps the secondary nav to only the new screen's views", async () => {
    const { unmount } = await openAt("/people/owners");
    expect(
      within(secondaryNav("People"))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Members",
      "Groups",
      "Owners",
      "Thresholds",
      "Erasure and suppression",
      "Tokens",
      "Audit log",
    ]);
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

  it("marks the open screen and the open view as current", async () => {
    await openAt("/people/thresholds");

    const marked = within(rail())
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"))
      .map((link) => link.textContent);
    expect(marked).toEqual(["People"]);

    const current = within(secondaryNav("People")).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Thresholds");
  });

  it("names where the person is in the top bar", async () => {
    await openAt("/system/routes-and-spend");

    const bar = screen.getByRole("banner");
    expect(within(bar).getByText("System", { exact: false })).toBeDefined();
    expect(within(bar).getByText("Routes and spend", { exact: false })).toBeDefined();
  });

  it("says nothing about the person until it knows them", async () => {
    const { container } = await openAt("/system");

    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(container.textContent).not.toMatch(/sign out/i);
  });

  it("calls every screen but Sources, People and System unbuilt", async () => {
    const unbuilt: string[] = [];
    for (const each of SCREENS) {
      const { unmount } = await openAt(each.path);
      if (screen.queryByText("This view is not built yet.") !== null) unbuilt.push(each.name);
      unmount();
    }

    expect(unbuilt).toEqual(["Suggestions", "Knowledge", "Questions"]);
  });

  it("gives System the routes card and calls the rest unbuilt", async () => {
    await openAt("/system");

    expect(screen.getByRole("heading", { level: 2, name: "Routes" })).toBeDefined();

    expect(screen.getByText(/The rest of System/)).toBeDefined();
  });

  it("shows No such screen for an unknown address", async () => {
    await openAt("/not-a-screen");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No such screen");
  });

  it("says No such screen for an unknown view, regions kept", async () => {
    await openAt("/system/not-a-view");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No such screen");
    expect(rail()).toBeDefined();
    expect(secondaryNav("System")).toBeDefined();
    expect(screen.getByRole("banner")).toBeDefined();
  });
});

const EVERY_SCREEN: readonly Screen[] = [...SCREENS, ...CONSOLE_SCREENS];

/**
 * One direction finds the view the router forgot; only the other finds the route nothing declared.
 */
const declaredViewPaths = (screens: readonly Screen[] = SCREENS): readonly string[] =>
  screens.flatMap((each) => viewsOf(each).map((view) => view.path));

const routedViewPaths = (): readonly string[] => {
  const router = createAppRouter(
    createAppClients(),
    createMemoryHistory({ initialEntries: ["/system"] }),
  );
  return Object.keys(router.routesByPath).filter((path) =>
    EVERY_SCREEN.some((each) => path.startsWith(`${each.path}/`)),
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
  it("declares each screen's views in the glossary's words and order", () => {
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
      [
        "People",
        [
          "Members",
          "Groups",
          "Owners",
          "Thresholds",
          "Erasure and suppression",
          "Tokens",
          "Audit log",
        ],
      ],
      ["System", ["Signals", "Health", "Routes and spend", "Backups"]],
    ]);
  });

  it("names the default view each screen's address leads to", () => {
    expect(SCREENS.map((each) => [each.path, each.defaultView])).toEqual([
      ["/sources", "/sources/bindings"],
      ["/suggestions", "/suggestions/queue"],
      ["/knowledge", "/knowledge/review-table"],
      ["/questions", "/questions/answer-audit"],
      ["/people", "/people/members"],
      ["/system", "/system/routes-and-spend"],
    ]);
  });

  it("calls only bindings, members, the audit log and routes built", () => {
    const built = SCREENS.flatMap((each) =>
      viewsOf(each)
        .filter((view) => view.built)
        .map((view) => view.path),
    );

    expect(built).toEqual([
      "/sources/bindings",
      "/people/members",
      "/people/audit-log",
      "/system/routes-and-spend",
    ]);
  });

  it("gives every declared view a route of its own", () => {
    const routed = routedViewPaths();

    expect(declaredViewPaths(EVERY_SCREEN).filter((path) => !routed.includes(path))).toEqual([]);
  });

  it("routes no view the list does not declare", () => {
    const declared = declaredViewPaths(EVERY_SCREEN);

    expect(routedViewPaths().filter((path) => !declared.includes(path))).toEqual([]);
  });

  it("gives every declared view an entry in the secondary nav", async () => {
    const reached = await navigatedViewPaths();

    expect(declaredViewPaths().filter((path) => !reached.includes(path))).toEqual([]);
  });

  it("lists no secondary-nav entry the list does not declare", async () => {
    const declared = declaredViewPaths();

    expect((await navigatedViewPaths()).filter((path) => !declared.includes(path))).toEqual([]);
  });

  it("gives each screen a glyph of its own", () => {
    expect(new Set(SCREENS.map((each) => each.icon)).size).toBe(SCREENS.length);
  });

  it("defaults each screen to one of its declared views", () => {
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
      "/people/members",
      "/system/routes-and-spend",
    ]);
  });

  it("opens every view at its address, saying which are unbuilt", async () => {
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

describe("the console's own list of screens and their views", () => {
  it("declares People and Workspaces, apart from Control Centre's six", () => {
    expect(
      CONSOLE_SCREENS.map((each) => [each.name, viewsOf(each).map((view) => view.name)]),
    ).toEqual([
      ["People", ["Everyone", "Names waiting"]],
      ["Workspaces", ["Every workspace"]],
    ]);
    expect(CONSOLE.screens.map((each) => each.name)).toEqual(["People", "Workspaces"]);
    expect(CONTROL_CENTRE.screens.map((each) => each.name)).toEqual([
      "Sources",
      "Suggestions",
      "Knowledge",
      "Questions",
      "People",
      "System",
    ]);
  });

  it("keeps every console screen and view under the console's address", () => {
    const outside = declaredViewPaths(CONSOLE_SCREENS)
      .concat(CONSOLE_SCREENS.map((each) => each.path))
      .filter((path) => !path.startsWith("/console/"));

    expect(outside).toEqual([]);
  });

  it("calls the Workspaces list built, and People's two views not", () => {
    expect(
      declaredViewPaths(CONSOLE_SCREENS).filter((path) =>
        CONSOLE_SCREENS.some((each) =>
          viewsOf(each).some((view) => view.path === path && view.built),
        ),
      ),
    ).toEqual(["/console/workspaces/every-workspace"]);
  });

  it("lands each console screen's own address on its default view", async () => {
    const landed: string[] = [];
    for (const each of CONSOLE_SCREENS) {
      const { router } = await appAt(each.path);
      landed.push(router.state.location.pathname);
    }

    expect(landed).toEqual(["/console/people/everyone", "/console/workspaces/every-workspace"]);
  });
});
