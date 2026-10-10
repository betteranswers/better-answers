import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { goHome, JUMP_TO, RAIL, UNKNOWN_PAGE } from "@/app/words.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import {
  EVERY_AREA,
  headingOf,
  HOMES,
  movedWithin,
  readerOf,
  pagesOf,
  AREAS,
  visibleTo,
  type Role,
  type Page,
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

const menu = () => screen.getByRole("navigation", { name: "Control Centre" });

const namesIn = (region: HTMLElement, role: "link" | "heading" = "link") =>
  within(region)
    .queryAllByRole(role, role === "heading" ? { level: 3 } : {})
    .map((each) => each.textContent);

describe("the shell's regions", () => {
  it("names only an Admin's areas in the icon rail", async () => {
    await openAs("Admin", "/people/members");

    expect(namesIn(rail())).toEqual(["Knowledge", "Control Centre"]);
  });

  it("names Ask and Knowledge in a Viewer's icon rail", async () => {
    await openAs("Viewer", "/ask");

    expect(namesIn(rail())).toEqual(["Ask", "Knowledge"]);
  });

  it("names no area while the role is unknown", async () => {
    await openWithNoRoleAt("/people/members");

    expect(namesIn(rail())).toEqual([]);
  });

  it("carries four landmark regions and a skip link first", async () => {
    const { container } = await openAs("Admin", "/models/models-and-spend");

    expect(rail()).toBeDefined();
    expect(menu()).toBeDefined();
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();

    const first = container.querySelector("a");
    expect(first?.textContent).toBe("Skip to the page");
    expect(first?.getAttribute("href")).toBe(`#${screen.getByRole("main").id}`);
  });

  it("lists the open area's groups over their pages", async () => {
    await openAs("Admin", "/system/audit-log");

    expect(namesIn(menu(), "heading")).toEqual(["Sources", "Models", "People", "System"]);
    expect(namesIn(menu())).toEqual([
      "Connected sources",
      "Models and spend",
      "Members",
      "Groups",
      "Audit log",
    ]);
  });

  it("marks the open area and the open page as current", async () => {
    await openAs("Admin", "/people/groups");

    const marked = within(rail())
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"))
      .map((link) => link.textContent);
    expect(marked).toEqual(["Control Centre"]);

    const current = within(menu()).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Groups");
  });

  it("names area, group and page in the band", async () => {
    await openAs("Admin", "/models/models-and-spend");

    const bar = screen.getByRole("banner");
    for (const name of ["Control Centre", "Models", "Models and spend"]) {
      expect(within(bar).getByText(name, { exact: true })).toBeDefined();
    }
  });

  it("names an area's home once in the band", async () => {
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

  it("names the menu with no heading repeating the rail", async () => {
    await openAs("Admin", "/people/members");

    const headings = within(menu())
      .queryAllByRole("heading")
      .map((each) => each.textContent);
    expect(headings).not.toContain("Control Centre");
  });

  it("gives every page in the menu its icon", async () => {
    await openAs("Admin", "/people/members");

    const bare = within(menu())
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

  it("gives Models the model choices card", async () => {
    await openAs("Admin", "/models/models-and-spend");

    expect(screen.getByRole("heading", { level: 2, name: "Model choices" })).toBeDefined();
  });

  it("says an unknown address names no page", async () => {
    await openApp("/not-a-page");

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      UNKNOWN_PAGE.heading,
    );
  });

  it("sends a reader of unknown role home by the index", async () => {
    await openApp("/not-a-page");

    const home = await screen.findByRole("link", { name: goHome(undefined) });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("says an unknown page names no place, rail kept", async () => {
    await openAs("Admin", "/system/not-a-page");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(UNKNOWN_PAGE.heading);
    expect(namesIn(rail())).toEqual(["Knowledge", "Control Centre"]);
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.queryByRole("navigation", { name: "Control Centre" })).toBeNull();
  });
});

describe("jump to, while no role is held", () => {
  it("is not offered in the band", async () => {
    await openWithNoRoleAt("/people/members");

    const band = within(screen.getByRole("banner"));
    expect(band.queryByRole("button", { name: JUMP_TO.name })).toBeNull();
  });

  it("leaves its chord to the browser", async () => {
    await openWithNoRoleAt("/people/members");

    const unclaimed = fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(unclaimed).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is left off the keystrokes list", async () => {
    await openWithNoRoleAt("/people/members");

    fireEvent.keyDown(document.body, { key: "?" });
    const actions = [...screen.getByRole("dialog").querySelectorAll("dd")].map(
      (each) => each.textContent,
    );

    expect(actions).toContain(KEYSTROKE_WORDS.showTheList);
    expect(actions).not.toContain(JUMP_TO.name);
  });
});

/** Drawn by the router alone: the list's own entries and the ways into and out of the shell. */
const OUTSIDE_THE_LIST = [
  "/",
  "/console",
  "/sign-in",
  "/sign-in/link",
  "/display-name",
  "/confirm",
  "/recovery",
  "/setup",
  "/recovery-codes",
  "/account",
  "/choose-workspace",
  "/no-workspace",
  "/invitations/$invitationId",
];

const routedPaths = (): readonly string[] =>
  Object.keys(
    createAppRouter(createAppClients(), createMemoryHistory({ initialEntries: ["/"] }))
      .routesByPath,
  ).filter((path) => !OUTSIDE_THE_LIST.includes(path));

/** A detail address as the router names its segment. */
const detailRouteOf = (each: Page): readonly string[] =>
  each.detail === undefined ? [] : [`${each.path}/$${each.detail.param}`];

/** One direction finds the page the router forgot; only the other finds a route nothing declared. */
const destinations = [
  ...new Set([
    ...pagesOf(EVERY_AREA)
      .filter((each) => each.built)
      .flatMap((each) => [each.path, ...detailRouteOf(each)]),
    ...Object.values(HOMES).map((home) => home.path),
  ]),
];

const moved = movedWithin(EVERY_AREA);

/** Every link in the menu, area by area, as the role reaches it from the rail. */
const navigatedPaths = async (role: Role): Promise<readonly string[]> => {
  vi.stubGlobal("fetch", answeringAs(role));
  const reached: string[] = [];
  for (const area of visibleTo(readerOf(role), AREAS).areas) {
    const { rendered } = await openApp(area.opensAt.path);
    const nav = screen.getByRole("navigation", { name: area.name });
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
  pagesOf(visibleTo(readerOf(role), AREAS).areas).map((each) => each.path);

describe("the routes and navigation built from the one list", () => {
  it("routes every built page, its detail and each role's home", () => {
    const routed = routedPaths();

    expect(destinations.filter((path) => !routed.includes(path))).toEqual([]);
    expect(routed).toContain("/people/members/$personId");
  });

  it("routes nothing but built pages, details, homes and moves", () => {
    const known = [...destinations, ...moved.map((each) => each.from)];

    expect(routedPaths().filter((path) => !known.includes(path))).toEqual([]);
  });

  it("routes every moved address, each leading to a built page", () => {
    const routed = routedPaths();
    const leadsNowhere = moved
      .filter((each) => !each.to.some((page) => page.built))
      .map((each) => each.from);

    expect(moved.filter((each) => !routed.includes(each.from))).toEqual([]);
    expect(leadsNowhere).toEqual([]);
  });

  for (const role of ["Admin", "Editor", "Viewer"] as const) {
    it(`lists each page ${aRole(role)} may see, and no other`, async () => {
      const reached = await navigatedPaths(role);
      const shown = shownPaths(role);

      expect(shown.filter((path) => !reached.includes(path))).toEqual([]);
      expect(reached.filter((path) => !shown.includes(path))).toEqual([]);
    });
  }

  it("opens every built page under its group's heading", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));

    for (const each of pagesOf(AREAS).filter((candidate) => candidate.built)) {
      const { rendered } = await openApp(each.path);
      const main = screen.getByRole("main");
      expect(within(main).getAllByRole("heading", { level: 1 })[0]?.textContent).toBe(
        headingOf(each),
      );
      rendered.unmount();
    }
  });
});
