import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FAILED_PAGE, goHome, RAIL, unbuiltLineOf, UNKNOWN_PAGE } from "@/app/words.ts";
import { MEMBER_PAGE_WORDS } from "@/features/people/member-act-words.ts";
import { aRole, ROLES } from "@/features/people/role-meanings.ts";
import {
  CONSOLE,
  CONTROL_CENTRE,
  detailAt,
  menuGroupIn,
  headingOf,
  hides,
  HOMES,
  movedWithin,
  placeAt,
  readerOf,
  pageNamed,
  pagesOf,
  AREAS,
  visibleTo,
  type Role,
  type Page,
  type Area,
} from "@/shared/navigation.ts";

import { appAt, openApp } from "./open-app.tsx";
import { addressOf, answeringAs, withTheApiDown } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const outline = (areas: readonly Area[]) =>
  areas.map((area) => [
    area.name,
    area.menuGroups.map((group) => [group.name ?? null, group.pages.map((each) => each.name)]),
  ]);

/** Every page called built and no home standing in, so what shows is the roles' doing. */
const builtThroughout = (area: Area): Area => ({
  id: area.id,
  name: area.name,
  icon: area.icon,
  menuGroups: area.menuGroups.map((group) => ({
    ...group,
    pages: group.pages.map((each) => ({ ...each, built: true })),
  })),
});

const aPage = (name: string, built: boolean, owners?: true): Page => ({
  name,
  path: `/a/${name.toLowerCase()}`,
  icon: "map",
  built,
  seenBy: ["Admin"],
  ...(owners === undefined ? {} : { owners }),
});

describe("the one navigation list", () => {
  it("declares ADR 0047's areas, groups and pages in order", () => {
    expect(outline(AREAS)).toEqual([
      ["Ask", [[null, ["New question", "Your questions"]]]],
      [
        "Knowledge",
        [
          ["Browse", ["Search", "Guides"]],
          [
            "Curation",
            [
              "All knowledge",
              "Due for verification",
              "Conflicts",
              "Kinds",
              "Domains and owners",
              "Exports",
            ],
          ],
        ],
      ],
      ["Inbox", [[null, ["Waiting on you"]]]],
      [
        "Control Centre",
        [
          ["Overview", ["Overview"]],
          ["Suggestions", ["Queue"]],
          [
            "Sources",
            [
              "Connected sources",
              "Publishing rules",
              "Cost estimates",
              "Backlogs",
              "Removed at source",
              "Share agents",
            ],
          ],
          ["Models", ["Models and spend", "Spending limit"]],
          ["Questions", ["Answer audit", "Answer tests"]],
          ["People", ["Members", "Groups", "Personal tokens"]],
          ["Personal data", ["Erasure and suppression"]],
          ["System", ["Audit log", "Signals", "Health", "Backups"]],
        ],
      ],
    ]);
  });

  it("declares the console apart, for the operator alone", () => {
    expect(outline([CONSOLE])).toEqual([
      [
        "Console",
        [
          ["People", ["Everyone", "Names waiting"]],
          ["Workspaces", ["Every workspace"]],
        ],
      ],
    ]);
    expect(AREAS).not.toContain(CONSOLE);
    expect(pagesOf([CONSOLE]).map((each) => each.seenBy)).toEqual([
      ["operator"],
      ["operator"],
      ["operator"],
    ]);
  });

  it("calls only today's eight pages built", () => {
    expect(
      pagesOf([...AREAS, CONSOLE])
        .filter((each) => each.built)
        .map((each) => each.path),
    ).toEqual([
      "/sources/connected-sources",
      "/models/models-and-spend",
      "/people/members",
      "/people/groups",
      "/system/audit-log",
      "/console/people/everyone",
      "/console/people/names-waiting",
      "/console/workspaces/every-workspace",
    ]);
  });

  it("keeps group addresses at the root, the console's under /console", () => {
    const controlCentre = AREAS.find((area) => area.name === "Control Centre");
    const strays = (controlCentre?.menuGroups ?? []).flatMap((group) =>
      group.pages.filter((each) => !each.path.startsWith(`/${group.id}`)).map((each) => each.path),
    );

    expect(strays).toEqual([]);
    expect(pagesOf([CONSOLE]).filter((each) => !each.path.startsWith("/console/"))).toEqual([]);
  });

  it("homes Admins on Members, Editors and Viewers on Ask", () => {
    expect(ROLES.map((role) => [role, HOMES[role].path])).toEqual([
      ["Admin", "/people/members"],
      ["Editor", "/ask"],
      ["Viewer", "/ask"],
    ]);
    expect(HOMES.operator.path).toBe("/console/workspaces/every-workspace");
  });

  it("gives each area a glyph of its own", () => {
    const glyphs = [...AREAS, CONSOLE].map((area) => area.icon);

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("what each person is shown", () => {
  for (const role of ["Editor", "Viewer"] as const) {
    it(`shows ${aRole(role)} Ask alone, at their home`, () => {
      const shown = visibleTo(readerOf(role), AREAS);

      expect(outline(shown.areas)).toEqual([["Ask", [[null, ["Ask"]]]]]);
      expect(shown.home).toBe(HOMES[role]);
      expect(shown.areas[0]?.opensAt).toBe(HOMES[role]);
    });
  }

  it("shows an Admin Control Centre's built pages alone", () => {
    const shown = visibleTo(readerOf("Admin"), AREAS);

    expect(outline(shown.areas)).toEqual([
      [
        "Control Centre",
        [
          ["Sources", ["Connected sources"]],
          ["Models", ["Models and spend"]],
          ["People", ["Members", "Groups"]],
          ["System", ["Audit log"]],
        ],
      ],
    ]);
    expect(shown.home).toBe(HOMES.Admin);
    expect(shown.areas[0]?.opensAt).toBe(HOMES.Admin);
  });

  it("shows nothing and no home while the role is unknown", () => {
    expect(visibleTo(readerOf(undefined), AREAS)).toEqual({
      areas: [],
      home: undefined,
    });
  });

  it("shows the operator the console, opening on Every workspace", () => {
    const shown = visibleTo(readerOf("operator"), [CONSOLE]);

    expect(outline(shown.areas)).toEqual(outline([CONSOLE]));
    expect(shown.areas[0]?.opensAt).toBe(HOMES.operator);
    expect(visibleTo(readerOf("operator"), AREAS).areas).toEqual([]);
  });

  it("hides unbuilt groups, and areas left with no group", () => {
    const anArea: Area = {
      id: "a",
      name: "A",
      icon: "map",
      menuGroups: [
        { id: "built", name: "Built", pages: [aPage("Shown", true), aPage("Not", false)] },
        { id: "unbuilt", name: "Unbuilt", pages: [aPage("Never", false)] },
      ],
    };
    const unbuilt: Area = { ...anArea, id: "b", name: "B", menuGroups: anArea.menuGroups.slice(1) };

    const shown = visibleTo(readerOf("Admin"), [anArea, unbuilt]);

    expect(outline(shown.areas)).toEqual([["A", [["Built", ["Shown"]]]]]);
    expect(shown.areas[0]?.opensAt.name).toBe("Shown");
  });

  it("shows a page to its roles, and owners where marked", () => {
    const anArea: Area = {
      id: "a",
      name: "A",
      icon: "map",
      menuGroups: [
        {
          id: "g",
          name: "G",
          pages: [aPage("Owned", true, true), aPage("Roles", true), aPage("Later", false, true)],
        },
      ],
    };

    const namesFor = (role: Role, owns: readonly string[]) =>
      pagesOf(visibleTo({ role, owns }, [anArea]).areas).map((each) => each.name);

    expect(namesFor("Admin", [])).toEqual(["Owned", "Roles"]);
    expect(namesFor("Viewer", [])).toEqual([]);
    expect(namesFor("Viewer", ["Answer"])).toEqual(["Owned"]);
  });

  it("declares who sees each group once its pages are built", () => {
    const groupsFor = (role: Role, owns: readonly string[]) =>
      visibleTo({ role, owns }, AREAS.map(builtThroughout)).areas.map((area) => [
        area.name,
        area.menuGroups.map((group) => group.name ?? null),
      ]);
    const controlCentre = [
      "Overview",
      "Suggestions",
      "Sources",
      "Models",
      "Questions",
      "People",
      "Personal data",
      "System",
    ];

    expect(groupsFor("Admin", [])).toEqual([
      ["Ask", [null]],
      ["Knowledge", ["Browse", "Curation"]],
      ["Inbox", [null]],
      ["Control Centre", controlCentre],
    ]);
    for (const role of ["Editor", "Viewer"] as const) {
      expect(groupsFor(role, [])).toEqual([
        ["Ask", [null]],
        ["Knowledge", ["Browse"]],
      ]);
      expect(groupsFor(role, ["Answer"])).toEqual([
        ["Ask", [null]],
        ["Knowledge", ["Browse", "Curation"]],
        ["Inbox", [null]],
      ]);
    }
  });
});

const MEMBERS = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members");

const A_PERSON = "01JBZ6Q2V7Y9K3M5N8P0R2T4W6";

describe("a member page, declared beneath Members", () => {
  it("places a person's address at Members, holding the person", () => {
    const place = placeAt(AREAS, `${MEMBERS.path}/${A_PERSON}`);

    expect(place?.page).toBe(MEMBERS);
    expect(place?.menuGroup?.name).toBe("People");
    expect(place?.detail).toBe(A_PERSON);
    expect(placeAt(AREAS, MEMBERS.path)?.detail).toBeUndefined();
  });

  it("places nothing deeper, nor beneath a page declaring no detail", () => {
    const placed = [
      `${MEMBERS.path}/${A_PERSON}/x`,
      `${MEMBERS.path}/`,
      `/people/groups/${A_PERSON}`,
      `/system/audit-log/${A_PERSON}`,
    ].filter((path) => placeAt(AREAS, path) !== undefined);

    expect(placed).toEqual([]);
  });

  it("lists the page nowhere, so no page list grows", () => {
    const paths = pagesOf([...AREAS, CONSOLE]).map((each) => each.path);

    expect(paths.filter((path) => path.startsWith(`${MEMBERS.path}/`))).toEqual([]);
  });

  it("hides it exactly where Members is hidden", () => {
    const path = detailAt(MEMBERS, A_PERSON);

    expect(path).toBe(`${MEMBERS.path}/${A_PERSON}`);
    expect(hides(visibleTo(readerOf("Admin"), AREAS), path)).toBe(false);
    for (const role of ["Editor", "Viewer"] as const) {
      expect(hides(visibleTo(readerOf(role), AREAS), path)).toBe(true);
    }
  });

  it("refuses an address beneath a page that declares none", () => {
    expect(() => detailAt(HOMES.Editor, A_PERSON)).toThrow(/declares no detail address/);
  });
});

const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

const MOVED = [
  ["/people/audit-log", "/system/audit-log"],
  ["/system/routes-and-spend", "/models/models-and-spend"],
  ["/agent-operations/routes-and-spend", "/models/models-and-spend"],
  ["/people", "/people/members"],
  ["/sources", "/sources/connected-sources"],
  ["/sources/bindings", "/sources/connected-sources"],
  ["/system", "/system/audit-log"],
] as const;

describe("an address that moved", () => {
  for (const [from, to] of MOVED) {
    it(`leads an Admin from ${from} to ${to}`, async () => {
      vi.stubGlobal("fetch", answeringAs("Admin"));

      const { router } = await appAt(from);

      expect(router.state.location.pathname).toBe(to);
    });

    for (const role of ["Editor", "Viewer"] as const) {
      it(`shows ${aRole(role)} at ${from} the not-found page`, async () => {
        vi.stubGlobal("fetch", answeringAs(role));

        const { router } = await openApp(from);

        expect(heading()).toBe(UNKNOWN_PAGE.heading);
        expect(router.state.location.pathname).toBe(from);
      });
    }

    it(`shows the failed read at ${from}, no role held`, async () => {
      const clients = withTheApiDown();

      const { router } = await openApp(from, clients);
      await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

      expect(heading()).toBe(FAILED_PAGE.heading);
      expect(router.state.location.pathname).toBe(from);
    });
  }

  for (const [from, to] of [
    ["/console/people", "/console/people/everyone"],
    ["/console/workspaces", "/console/workspaces/every-workspace"],
  ] as const) {
    it(`leads the operator from ${from} to ${to}`, async () => {
      vi.stubGlobal("fetch", answeringAs("Viewer", true));

      const { router } = await appAt(from);

      expect(router.state.location.pathname).toBe(to);
    });
  }

  it("leads every older address of a page or group", () => {
    const moved = { ...aPage("Moved", true), movedFrom: ["/first", "/second"] };
    const anArea: Area = {
      id: "a",
      name: "A",
      icon: "map",
      menuGroups: [{ id: "g", name: "G", pages: [moved], movedFrom: ["/g", "/older-g"] }],
    };

    expect(movedWithin([anArea])).toEqual([
      { from: "/g", to: [moved] },
      { from: "/older-g", to: [moved] },
      { from: "/first", to: [moved] },
      { from: "/second", to: [moved] },
    ]);
  });
});

describe("an address the person may not see", () => {
  it("shows a Viewer Members as not found, offering Ask", async () => {
    vi.stubGlobal("fetch", answeringAs("Viewer"));

    const hidden = await openApp("/people/members");
    const main = screen.getByRole("main");
    await within(main).findByRole("link", { name: goHome(HOMES.Viewer) });
    const drawn = { main: main.innerHTML, banner: screen.getByRole("banner").textContent };
    hidden.rendered.unmount();

    await openApp("/people/not-a-page");
    await within(screen.getByRole("main")).findByRole("link", { name: goHome(HOMES.Viewer) });

    expect(heading()).toBe(UNKNOWN_PAGE.heading);
    expect(screen.getByRole("main").innerHTML).toBe(drawn.main);
    expect(screen.getByRole("banner").textContent).toBe(drawn.banner);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows an Admin Ask as not found, not their home", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));

    await openApp("/ask");

    expect(heading()).toBe(UNKNOWN_PAGE.heading);
  });

  it("tells a Viewer at Ask it is on its way", async () => {
    vi.stubGlobal("fetch", answeringAs("Viewer"));

    await openApp("/ask");

    expect(heading()).toBe(HOMES.Viewer.name);
    expect(screen.getByText(unbuiltLineOf(HOMES.Viewer))).toBeDefined();
  });

  for (const role of ["Editor", "Viewer"] as const) {
    it(`shows ${aRole(role)} a member page as not found`, async () => {
      vi.stubGlobal("fetch", answeringAs(role));

      await openApp(`${MEMBERS.path}/${A_PERSON}`);
      await within(screen.getByRole("main")).findByRole("link", { name: goHome(HOMES[role]) });

      expect(heading()).toBe(UNKNOWN_PAGE.heading);
    });
  }

  it("shows an Admin a deeper address as not found", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));

    await openApp(`${MEMBERS.path}/${A_PERSON}/x`);

    expect(heading()).toBe(UNKNOWN_PAGE.heading);
  });

  it("names no one at a malformed member address, asking nothing", async () => {
    const asked: string[] = [];
    const answering = answeringAs("Admin");
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      asked.push(addressOf(input).pathname);
      return answering(input);
    });

    await openApp(`${MEMBERS.path}/not-a-person`);
    await screen.findByText(MEMBER_PAGE_WORDS.noSuchMember);

    expect(heading()).toBe(headingOf(MEMBERS));
    expect(screen.getByRole("link", { name: MEMBER_PAGE_WORDS.toMembers })).toBeDefined();
    expect(asked.filter((path) => path.includes("members."))).toEqual([]);
  });

  for (const path of ["/people/thresholds", "/suggestions/queue", "/knowledge/search"]) {
    it(`shows an Admin the unbuilt ${path} as not found`, async () => {
      vi.stubGlobal("fetch", answeringAs("Admin"));

      const { router } = await openApp(path);

      expect(heading()).toBe(UNKNOWN_PAGE.heading);
      expect(router.state.location.pathname).toBe(path);
    });
  }
});

describe("a role changed while the person is on a page", () => {
  it("keeps the page until the next move, then hides it", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));
    const { router, clients } = await openApp("/people/groups");
    expect(heading()).toBe("People");

    vi.stubGlobal("fetch", answeringAs("Editor"));
    await clients.queryClient.invalidateQueries();
    const rail = screen.getByRole("navigation", { name: RAIL });
    await within(rail).findByRole("link", { name: "Ask" });

    expect(heading()).toBe("People");
    expect(screen.getByRole("main").textContent).not.toContain(UNKNOWN_PAGE.heading);

    await router.navigate({ href: HOMES.Editor.path });
    await router.navigate({ href: "/people/groups" });

    expect(
      await screen.findByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading }),
    ).toBeDefined();
  });
});
