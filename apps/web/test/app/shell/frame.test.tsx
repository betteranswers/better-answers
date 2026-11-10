import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";
import { goHome, JUMP_TO as JUMP_TO_WORDS, SKIP_TO_MAIN, UNKNOWN_PAGE } from "@/app/words.ts";
import { MODEL_CHOICES_WORDS } from "@/features/model-choices/words.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import {
  AREAS,
  CONTROL_CENTRE,
  EVERY_AREA,
  HOMES,
  movedWithin,
  NEW_QUESTION,
  pagesOf,
  readerOf,
  type Page,
  type Role,
  visibleTo,
} from "@/shared/navigation.ts";
import { openApp } from "@test/open-app.tsx";
import { answeringAs, withTheApiDown } from "@test/stubbed-api.ts";

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

const rail = () => screen.getByRole("navigation", { name: "Areas" });

const menu = () => screen.getByRole("navigation", { name: "Control Centre" });

const JUMP_TO = JUMP_TO_WORDS.name;

const namesIn = (region: HTMLElement, role: "link" | "heading" = "link") =>
  within(region)
    .queryAllByRole(role, role === "heading" ? { level: 3 } : {})
    .map((each) => each.textContent);

const controlCentrePage = (group: string, id: string): string => {
  const pages = CONTROL_CENTRE.menuGroups.find((each) => each.id === group)?.pages ?? [];
  const page: Page | undefined = pages.find((each) => each.id === id);
  if (page === undefined) throw new Error(`the Control Centre has no page ${group}/${id}`);
  return page.name;
};

describe("the shell's regions", () => {
  it("lists an Admin's areas in the rail", async () => {
    await openAs("Admin", "/people/members");

    expect(namesIn(rail())).toEqual(["Ask", "Knowledge", "Inbox", "Control Centre"]);
  });

  it("lists Ask and Knowledge in a Viewer's rail", async () => {
    await openAs("Viewer", "/ask/new-question");

    expect(namesIn(rail())).toEqual(["Ask", "Knowledge"]);
  });

  it("lists no areas while the role is unknown", async () => {
    await openWithNoRoleAt("/people/members");

    expect(namesIn(rail())).toEqual([]);
  });

  it("has four landmark regions and a leading skip link", async () => {
    const { container } = await openAs("Admin", "/models/models-and-spend");

    expect(rail()).toBeDefined();
    expect(menu()).toBeDefined();
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();

    const first = container.querySelector("a");
    expect(first).toBe(screen.getByRole("link", { name: SKIP_TO_MAIN }));
    expect(first?.getAttribute("href")).toBe(`#${screen.getByRole("main").id}`);
  });

  it("lists the open area's group headings and page links", async () => {
    await openAs("Admin", "/system/audit-log");

    expect(namesIn(menu(), "heading")).toEqual([
      "Sources",
      "Models",
      "Questions",
      "People",
      "System",
    ]);
    expect(namesIn(menu())).toEqual([
      controlCentrePage("sources", "connected-sources"),
      controlCentrePage("models", "models-and-spend"),
      controlCentrePage("questions", "questions-asked"),
      controlCentrePage("questions", "answer-tests"),
      "Members",
      "Groups",
      controlCentrePage("system", "audit-log"),
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

  it("shows the area, group and page in the band", async () => {
    await openAs("Admin", "/models/models-and-spend");

    const bar = screen.getByRole("banner");
    for (const name of [
      "Control Centre",
      "Models",
      controlCentrePage("models", "models-and-spend"),
    ]) {
      expect(within(bar).getByText(name, { exact: true })).toBeDefined();
    }
    expect(within(bar).getByRole("button", { name: JUMP_TO })).toBeDefined();
  });

  it("shows an area's home page name once in the band", async () => {
    await openAs("Viewer", HOMES.Viewer.path);

    expect(within(screen.getByRole("banner")).getAllByText("Ask")).toHaveLength(1);
  });

  it("links the band's logo to the reader's home", async () => {
    await openAs("Admin", "/system/audit-log");

    const logo = within(screen.getByRole("banner")).getByRole("link", { name: "better-answers" });
    expect(logo.getAttribute("href")).toBe(HOMES.Admin.path);
  });

  it("links the logo to / while the role is unknown", async () => {
    await openWithNoRoleAt("/people/members");

    const logo = within(screen.getByRole("banner")).getByRole("link", { name: "better-answers" });
    expect(logo.getAttribute("href")).toBe("/");
  });

  it("does not repeat the area name as a menu heading", async () => {
    await openAs("Admin", "/people/members");

    const headings = within(menu())
      .queryAllByRole("heading")
      .map((each) => each.textContent);
    expect(headings).not.toContain("Control Centre");
  });

  it("gives every page in the menu its icon", async () => {
    await openAs("Admin", "/people/members");

    const withoutIcon = within(menu())
      .getAllByRole("link")
      .filter((link) => link.querySelector("svg") === null)
      .map((link) => link.textContent);
    expect(withoutIcon).toEqual([]);
  });

  it("hides sign-out until the person is known", async () => {
    const { container } = await openWithNoRoleAt("/people/members");

    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(container.textContent).not.toMatch(/sign out/i);
  });

  it("shows the Model Choices card on Models and Spend", async () => {
    await openAs("Admin", "/models/models-and-spend");

    expect(
      screen.getByRole("heading", { level: 2, name: MODEL_CHOICES_WORDS.heading }),
    ).toBeDefined();
  });

  it("shows Page Not Found for an unknown address", async () => {
    await openApp("/not-a-page");

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      UNKNOWN_PAGE.heading,
    );
  });

  it("links a reader with an unknown role home through /", async () => {
    await openApp("/not-a-page");

    const home = await screen.findByRole("link", { name: goHome(undefined) });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("shows Page Not Found inside an area, keeping the rail", async () => {
    await openAs("Admin", "/system/not-a-page");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(UNKNOWN_PAGE.heading);
    expect(namesIn(rail())).toEqual(["Ask", "Knowledge", "Inbox", "Control Centre"]);
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.queryByRole("navigation", { name: "Control Centre" })).toBeNull();
  });
});

describe("a page's old address", () => {
  it("matches a missing page for a Viewer without access", async () => {
    const missingPage = await openAs("Viewer", "/people/not-a-page");
    await screen.findByRole("link", { name: goHome(NEW_QUESTION) });
    const missingPageMain = screen.getByRole("main").innerHTML;
    missingPage.unmount();

    vi.stubGlobal("fetch", answeringAs("Viewer"));
    const { router } = await openApp("/people/audit-log");

    await screen.findByRole("link", { name: goHome(NEW_QUESTION) });
    expect(router.history.location.pathname).toBe("/people/audit-log");
    expect(
      screen.getByRole("main").innerHTML,
      "the hidden page renders differently from a missing page",
    ).toBe(missingPageMain);
  });
});

describe("jump to, while the role is unknown", () => {
  it("is not offered in the band", async () => {
    await openWithNoRoleAt("/people/members");

    const band = within(screen.getByRole("banner"));
    expect(band.queryByRole("button", { name: JUMP_TO })).toBeNull();
  });

  it("leaves its keyboard shortcut to the browser", async () => {
    await openWithNoRoleAt("/people/members");

    const notPrevented = fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is missing from the keyboard shortcuts list", async () => {
    await openWithNoRoleAt("/people/members");

    fireEvent.keyDown(document.body, { key: "?" });
    const actions = [...screen.getByRole("dialog").querySelectorAll("dd")].map(
      (each) => each.textContent,
    );

    expect(actions).toContain(KEYSTROKE_WORDS.showTheList);
    expect(actions).not.toContain(JUMP_TO);
  });
});

const OUTSIDE_THE_LIST = new Set([
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
]);

const routedPaths = (): readonly string[] =>
  Object.keys(
    createAppRouter(createAppClients(), createMemoryHistory({ initialEntries: ["/"] }))
      .routesByPath,
  ).filter((path) => !OUTSIDE_THE_LIST.has(path));

const detailRouteOf = (each: Page): readonly string[] =>
  each.detail === undefined ? [] : [`${each.path}/$${each.detail.param}`];

const destinations = [
  ...new Set([
    ...pagesOf(EVERY_AREA)
      .filter((each) => each.built)
      .flatMap((each) => [each.path, ...detailRouteOf(each)]),
    ...Object.values(HOMES).map((home) => home.path),
  ]),
];

const moved = movedWithin(EVERY_AREA);

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

describe("routes and navigation built from the navigation list", () => {
  it("routes every built page, its detail and each role's home", () => {
    const routed = routedPaths();

    expect(destinations.filter((path) => !routed.includes(path))).toEqual([]);
    expect(routed).toContain("/people/members/$personId");
  });

  it("routes only built pages, details, homes and moved addresses", () => {
    const known = new Set([...destinations, ...moved.map((each) => each.from)]);

    expect(routedPaths().filter((path) => !known.has(path))).toEqual([]);
  });

  it("routes every moved address to a built page", () => {
    const routed = routedPaths();
    const withoutBuiltPage = moved
      .filter((each) => !each.to.some((page) => page.built))
      .map((each) => each.from);

    expect(moved.filter((each) => !routed.includes(each.from))).toEqual([]);
    expect(withoutBuiltPage).toEqual([]);
  });

  for (const role of ["Admin", "Editor", "Viewer"] as const) {
    it(`lists each page ${aRole(role)} may see, and no other`, async () => {
      const reached = await navigatedPaths(role);
      const shown = shownPaths(role);

      expect(shown.filter((path) => !reached.includes(path))).toEqual([]);
      expect(reached.filter((path) => !shown.includes(path))).toEqual([]);
    });
  }

  it("opens each built page with one h1, its own name", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));

    for (const each of pagesOf(AREAS).filter((candidate) => candidate.built)) {
      const { rendered } = await openApp(each.path);
      const main = screen.getByRole("main");
      expect(
        within(main)
          .getAllByRole("heading", { level: 1 })
          .map((heading) => heading.textContent),
      ).toEqual([each.name]);
      rendered.unmount();
    }
  });
});
