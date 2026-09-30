import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { goHome, RAIL, UNKNOWN_SCREEN } from "@/app/words.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import {
  EVERY_SURFACE,
  headingOf,
  HOMES,
  movedWithin,
  SURFACES,
  visibleTo,
  type Role,
  type Surface,
} from "@/shared/navigation.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { openApp } from "./open-app.tsx";
import { answeringAs, withTheApiDown } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openAs = async (role: Role, path: string) => {
  vi.stubGlobal("fetch", answeringAs(role));
  return (await openApp(path)).rendered;
};

const openWithNoRoleAt = async (path: string) => {
  const clients = withTheApiDown();
  const opened = await openApp(path, clients);
  await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));
  return opened.rendered;
};

const rail = () => screen.getByRole("navigation", { name: RAIL });

const secondaryNav = () => screen.getByRole("navigation", { name: "Control Centre" });

const namesIn = (region: HTMLElement, role: "link" | "heading" = "link") =>
  within(region)
    .queryAllByRole(role, role === "heading" ? { level: 3 } : {})
    .map((each) => each.textContent);

describe("the shell's regions", () => {
  it("names only an Admin's surfaces in the icon rail", async () => {
    await openAs("Admin", "/people/members");

    expect(namesIn(rail())).toEqual(["Control Centre"]);
  });

  it("names Ask alone in a Viewer's icon rail", async () => {
    await openAs("Viewer", "/ask");

    expect(namesIn(rail())).toEqual(["Ask"]);
  });

  it("names no surface while the role is unknown", async () => {
    await openWithNoRoleAt("/people/members");

    expect(namesIn(rail())).toEqual([]);
  });

  it("carries four landmark regions and a skip link first", async () => {
    const { container } = await openAs("Admin", "/agent-operations/routes-and-spend");

    expect(rail()).toBeDefined();
    expect(secondaryNav()).toBeDefined();
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();

    const first = container.querySelector("a");
    expect(first?.textContent).toBe("Skip to the screen");
    expect(first?.getAttribute("href")).toBe(`#${screen.getByRole("main").id}`);
  });

  it("lists the open surface's groups over their screens", async () => {
    await openAs("Admin", "/system/audit-log");

    expect(namesIn(secondaryNav(), "heading")).toEqual([
      "Sources",
      "Agent Operations",
      "People",
      "System",
    ]);
    expect(namesIn(secondaryNav())).toEqual([
      "Bindings",
      "Routes and spend",
      "Members",
      "Groups",
      "Audit log",
    ]);
  });

  it("marks the open surface and the open screen as current", async () => {
    await openAs("Admin", "/people/groups");

    const marked = within(rail())
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"))
      .map((link) => link.textContent);
    expect(marked).toEqual(["Control Centre"]);

    const current = within(secondaryNav()).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Groups");
  });

  it("names surface, group and screen in the band", async () => {
    await openAs("Admin", "/agent-operations/routes-and-spend");

    const bar = screen.getByRole("banner");
    for (const name of ["Control Centre", "Agent Operations", "Routes and spend"]) {
      expect(within(bar).getByText(name, { exact: true })).toBeDefined();
    }
  });

  it("names a surface's home once in the band", async () => {
    await openAs("Viewer", HOMES.Viewer.path);

    expect(within(screen.getByRole("banner")).getAllByText(HOMES.Viewer.name)).toHaveLength(1);
  });

  it("links the band's logo to the reader's home", async () => {
    await openAs("Admin", "/system/audit-log");

    const logo = within(screen.getByRole("banner")).getByRole("link", { name: PRODUCT_NAME });
    expect(logo.getAttribute("href")).toBe(HOMES.Admin.path);
  });

  it("links the logo to the index with no role held", async () => {
    await openWithNoRoleAt("/people/members");

    const logo = within(screen.getByRole("banner")).getByRole("link", { name: PRODUCT_NAME });
    expect(logo.getAttribute("href")).toBe("/");
  });

  it("names the secondary nav with no heading repeating the rail", async () => {
    await openAs("Admin", "/people/members");

    const headings = within(secondaryNav())
      .queryAllByRole("heading")
      .map((each) => each.textContent);
    expect(headings).not.toContain("Control Centre");
  });

  it("gives every screen in the secondary nav its icon", async () => {
    await openAs("Admin", "/people/members");

    const bare = within(secondaryNav())
      .getAllByRole("link")
      .filter((link) => link.querySelector("svg") === null)
      .map((link) => link.textContent);
    expect(bare).toEqual([]);
  });

  it("says nothing about the person until it knows them", async () => {
    const { container } = await openWithNoRoleAt("/people/members");

    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(container.textContent).not.toMatch(/sign out/i);
  });

  it("gives Agent Operations the routes card", async () => {
    await openAs("Admin", "/agent-operations/routes-and-spend");

    expect(screen.getByRole("heading", { level: 2, name: "Routes" })).toBeDefined();
  });

  it("says an unknown address names no screen", async () => {
    await openApp("/not-a-screen");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(UNKNOWN_SCREEN.heading);
  });

  it("sends a reader of unknown role home by the index", async () => {
    await openApp("/not-a-screen");

    expect(screen.getByRole("link", { name: goHome(undefined) }).getAttribute("href")).toBe("/");
  });

  it("says an unknown screen names no place, rail kept", async () => {
    await openAs("Admin", "/system/not-a-screen");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(UNKNOWN_SCREEN.heading);
    expect(namesIn(rail())).toEqual(["Control Centre"]);
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.queryByRole("navigation", { name: "Control Centre" })).toBeNull();
  });
});

/** Drawn by the router alone: the list's own entries and the ways into and out of the shell. */
const OUTSIDE_THE_LIST = [
  "/",
  "/console",
  "/sign-in",
  "/display-name",
  "/choose-workspace",
  "/no-workspace",
  "/invitations/$invitationId",
];

const routedPaths = (): readonly string[] =>
  Object.keys(
    createAppRouter(createAppClients(), createMemoryHistory({ initialEntries: ["/"] }))
      .routesByPath,
  ).filter((path) => !OUTSIDE_THE_LIST.includes(path));

const screensOf = (surfaces: readonly Surface[]) =>
  surfaces.flatMap((surface) => surface.groups.flatMap((group) => group.screens));

/** One direction finds the screen the router forgot; only the other finds a route nothing declared. */
const destinations = [
  ...new Set([
    ...screensOf(EVERY_SURFACE)
      .filter((each) => each.built)
      .map((each) => each.path),
    ...Object.values(HOMES).map((home) => home.path),
  ]),
];

const moved = movedWithin(EVERY_SURFACE);

/** Every link in the secondary nav, surface by surface, as the role reaches it from the rail. */
const navigatedPaths = async (role: Role): Promise<readonly string[]> => {
  vi.stubGlobal("fetch", answeringAs(role));
  const reached: string[] = [];
  for (const surface of visibleTo({ role, owns: [] }, SURFACES).surfaces) {
    const { rendered } = await openApp(surface.opensAt.path);
    const nav = screen.getByRole("navigation", { name: surface.name });
    reached.push(
      ...within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href") ?? ""),
    );
    rendered.unmount();
  }
  return reached;
};

const shownPaths = (role: Role): readonly string[] =>
  screensOf(visibleTo({ role, owns: [] }, SURFACES).surfaces).map((each) => each.path);

describe("the routes and navigation built from the one list", () => {
  it("gives every built screen and every role's home a route", () => {
    const routed = routedPaths();

    expect(destinations.filter((path) => !routed.includes(path))).toEqual([]);
  });

  it("routes nothing but built screens, homes and moved addresses", () => {
    const known = [...destinations, ...moved.map((each) => each.from)];

    expect(routedPaths().filter((path) => !known.includes(path))).toEqual([]);
  });

  it("routes every moved address, each leading to a built screen", () => {
    const routed = routedPaths();
    const leadsNowhere = moved
      .filter((each) => {
        const named = "screens" in each.to ? each.to.screens : [each.to];
        return !named.some((screen) => screen.built);
      })
      .map((each) => each.from);

    expect(moved.filter((each) => !routed.includes(each.from))).toEqual([]);
    expect(leadsNowhere).toEqual([]);
  });

  for (const role of ["Admin", "Editor", "Viewer"] as const) {
    it(`lists each screen ${aRole(role)} may see, and no other`, async () => {
      const reached = await navigatedPaths(role);
      const shown = shownPaths(role);

      expect(shown.filter((path) => !reached.includes(path))).toEqual([]);
      expect(reached.filter((path) => !shown.includes(path))).toEqual([]);
    });
  }

  it("opens every built screen under its group's heading", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));

    for (const each of screensOf(SURFACES).filter((candidate) => candidate.built)) {
      const { rendered } = await openApp(each.path);
      const main = screen.getByRole("main");
      expect(within(main).getAllByRole("heading", { level: 1 })[0]?.textContent).toBe(
        headingOf(each),
      );
      rendered.unmount();
    }
  });
});
