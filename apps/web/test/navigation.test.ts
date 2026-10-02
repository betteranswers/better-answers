import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FAILED_SCREEN, goHome, RAIL, unbuiltLineOf, UNKNOWN_SCREEN } from "@/app/words.ts";
import { MEMBER_PAGE_WORDS } from "@/features/people/member-act-words.ts";
import { aRole, ROLES } from "@/features/people/role-meanings.ts";
import {
  CONSOLE,
  CONTROL_CENTRE,
  detailAt,
  groupIn,
  headingOf,
  hides,
  HOMES,
  placeAt,
  readerOf,
  screenNamed,
  screensOf,
  SURFACES,
  visibleTo,
  type Role,
  type Screen,
  type Surface,
} from "@/shared/navigation.ts";

import { appAt, openApp } from "./open-app.tsx";
import { addressOf, answeringAs, withTheApiDown } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const outline = (surfaces: readonly Surface[]) =>
  surfaces.map((surface) => [
    surface.name,
    surface.groups.map((group) => [group.name ?? null, group.screens.map((each) => each.name)]),
  ]);

/** Every screen called built and no home standing in, so what shows is the roles' doing. */
const builtThroughout = (surface: Surface): Surface => ({
  id: surface.id,
  name: surface.name,
  icon: surface.icon,
  groups: surface.groups.map((group) => ({
    ...group,
    screens: group.screens.map((each) => ({ ...each, built: true })),
  })),
});

const aScreen = (name: string, built: boolean, owners?: true): Screen => ({
  name,
  path: `/a/${name.toLowerCase()}`,
  icon: "map",
  built,
  seenBy: ["Admin"],
  ...(owners === undefined ? {} : { owners }),
});

describe("the one navigation list", () => {
  it("declares ADR 0047's surfaces, groups and screens in order", () => {
    expect(outline(SURFACES)).toEqual([
      ["Ask", [[null, ["New question", "Your questions"]]]],
      [
        "Knowledge",
        [
          ["Browse", ["Search", "Guides"]],
          [
            "Curation",
            ["All knowledge", "Checks due", "Conflicts", "Kinds", "Domains and owners", "Exports"],
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
              "Bindings",
              "Publish and accept gates",
              "Priced plan",
              "Backlogs",
              "Gone-at-source impact",
              "Agent tokens",
            ],
          ],
          ["Agent Operations", ["Routes and spend", "Ceiling"]],
          ["Questions", ["Answer audit", "Answer tests"]],
          ["People", ["Members", "Groups", "Tokens"]],
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
    expect(SURFACES).not.toContain(CONSOLE);
    expect(screensOf([CONSOLE]).map((each) => each.seenBy)).toEqual([
      ["operator"],
      ["operator"],
      ["operator"],
    ]);
  });

  it("calls only today's eight screens built", () => {
    expect(
      screensOf([...SURFACES, CONSOLE])
        .filter((each) => each.built)
        .map((each) => each.path),
    ).toEqual([
      "/sources/bindings",
      "/agent-operations/routes-and-spend",
      "/people/members",
      "/people/groups",
      "/system/audit-log",
      "/console/people/everyone",
      "/console/people/names-waiting",
      "/console/workspaces/every-workspace",
    ]);
  });

  it("keeps group addresses at the root, the console's under /console", () => {
    const controlCentre = SURFACES.find((surface) => surface.name === "Control Centre");
    const strays = (controlCentre?.groups ?? []).flatMap((group) =>
      group.screens
        .filter((each) => !each.path.startsWith(`/${group.id}`))
        .map((each) => each.path),
    );

    expect(strays).toEqual([]);
    expect(screensOf([CONSOLE]).filter((each) => !each.path.startsWith("/console/"))).toEqual([]);
  });

  it("homes Admins on Members, Editors and Viewers on Ask", () => {
    expect(ROLES.map((role) => [role, HOMES[role].path])).toEqual([
      ["Admin", "/people/members"],
      ["Editor", "/ask"],
      ["Viewer", "/ask"],
    ]);
    expect(HOMES.operator.path).toBe("/console/workspaces/every-workspace");
  });

  it("gives each surface a glyph of its own", () => {
    const glyphs = [...SURFACES, CONSOLE].map((surface) => surface.icon);

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("what each person is shown", () => {
  for (const role of ["Editor", "Viewer"] as const) {
    it(`shows ${aRole(role)} Ask alone, at their home (AE2)`, () => {
      const shown = visibleTo(readerOf(role), SURFACES);

      expect(outline(shown.surfaces)).toEqual([["Ask", [[null, ["Ask"]]]]]);
      expect(shown.home).toBe(HOMES[role]);
      expect(shown.surfaces[0]?.opensAt).toBe(HOMES[role]);
    });
  }

  it("shows an Admin Control Centre's built screens alone (AE3)", () => {
    const shown = visibleTo(readerOf("Admin"), SURFACES);

    expect(outline(shown.surfaces)).toEqual([
      [
        "Control Centre",
        [
          ["Sources", ["Bindings"]],
          ["Agent Operations", ["Routes and spend"]],
          ["People", ["Members", "Groups"]],
          ["System", ["Audit log"]],
        ],
      ],
    ]);
    expect(shown.home).toBe(HOMES.Admin);
    expect(shown.surfaces[0]?.opensAt).toBe(HOMES.Admin);
  });

  it("shows nothing and no home while the role is unknown", () => {
    expect(visibleTo(readerOf(undefined), SURFACES)).toEqual({
      surfaces: [],
      home: undefined,
    });
  });

  it("shows the operator the console, opening on Every workspace", () => {
    const shown = visibleTo(readerOf("operator"), [CONSOLE]);

    expect(outline(shown.surfaces)).toEqual(outline([CONSOLE]));
    expect(shown.surfaces[0]?.opensAt).toBe(HOMES.operator);
    expect(visibleTo(readerOf("operator"), SURFACES).surfaces).toEqual([]);
  });

  it("hides unbuilt groups, and surfaces left with no group", () => {
    const aSurface: Surface = {
      id: "a",
      name: "A",
      icon: "map",
      groups: [
        { id: "built", name: "Built", screens: [aScreen("Shown", true), aScreen("Not", false)] },
        { id: "unbuilt", name: "Unbuilt", screens: [aScreen("Never", false)] },
      ],
    };
    const unbuilt: Surface = { ...aSurface, id: "b", name: "B", groups: aSurface.groups.slice(1) };

    const shown = visibleTo(readerOf("Admin"), [aSurface, unbuilt]);

    expect(outline(shown.surfaces)).toEqual([["A", [["Built", ["Shown"]]]]]);
    expect(shown.surfaces[0]?.opensAt.name).toBe("Shown");
  });

  it("shows a screen to its roles, and owners where marked", () => {
    const aSurface: Surface = {
      id: "a",
      name: "A",
      icon: "map",
      groups: [
        {
          id: "g",
          name: "G",
          screens: [
            aScreen("Owned", true, true),
            aScreen("Roles", true),
            aScreen("Later", false, true),
          ],
        },
      ],
    };

    const namesFor = (role: Role, owns: readonly string[]) =>
      screensOf(visibleTo({ role, owns }, [aSurface]).surfaces).map((each) => each.name);

    expect(namesFor("Admin", [])).toEqual(["Owned", "Roles"]);
    expect(namesFor("Viewer", [])).toEqual([]);
    expect(namesFor("Viewer", ["Answer"])).toEqual(["Owned"]);
  });

  it("declares who sees each group once its screens are built", () => {
    const groupsFor = (role: Role, owns: readonly string[]) =>
      visibleTo({ role, owns }, SURFACES.map(builtThroughout)).surfaces.map((surface) => [
        surface.name,
        surface.groups.map((group) => group.name ?? null),
      ]);
    const controlCentre = [
      "Overview",
      "Suggestions",
      "Sources",
      "Agent Operations",
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

const MEMBERS = screenNamed(groupIn(CONTROL_CENTRE, "people"), "Members");

const A_PERSON = "01JBZ6Q2V7Y9K3M5N8P0R2T4W6";

describe("a member page, declared beneath Members", () => {
  it("places a person's address at Members, holding the person", () => {
    const place = placeAt(SURFACES, `${MEMBERS.path}/${A_PERSON}`);

    expect(place?.screen).toBe(MEMBERS);
    expect(place?.group?.name).toBe("People");
    expect(place?.detail).toBe(A_PERSON);
    expect(placeAt(SURFACES, MEMBERS.path)?.detail).toBeUndefined();
  });

  it("places nothing deeper, nor beneath a screen declaring no detail", () => {
    const placed = [
      `${MEMBERS.path}/${A_PERSON}/x`,
      `${MEMBERS.path}/`,
      `/people/groups/${A_PERSON}`,
      `/system/audit-log/${A_PERSON}`,
    ].filter((path) => placeAt(SURFACES, path) !== undefined);

    expect(placed).toEqual([]);
  });

  it("lists the page nowhere, so no screen list grows", () => {
    const paths = screensOf([...SURFACES, CONSOLE]).map((each) => each.path);

    expect(paths.filter((path) => path.startsWith(`${MEMBERS.path}/`))).toEqual([]);
  });

  it("hides it exactly where Members is hidden", () => {
    const path = detailAt(MEMBERS, A_PERSON);

    expect(path).toBe(`${MEMBERS.path}/${A_PERSON}`);
    expect(hides(visibleTo(readerOf("Admin"), SURFACES), path)).toBe(false);
    for (const role of ["Editor", "Viewer"] as const) {
      expect(hides(visibleTo(readerOf(role), SURFACES), path)).toBe(true);
    }
  });

  it("refuses an address beneath a screen that declares none", () => {
    expect(() => detailAt(HOMES.Editor, A_PERSON)).toThrow(/declares no detail address/);
  });
});

const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

const MOVED = [
  ["/people/audit-log", "/system/audit-log"],
  ["/system/routes-and-spend", "/agent-operations/routes-and-spend"],
  ["/people", "/people/members"],
  ["/sources", "/sources/bindings"],
  ["/system", "/system/audit-log"],
] as const;

describe("an address that moved", () => {
  for (const [from, to] of MOVED) {
    it(`leads an Admin from ${from} to ${to} (AE8)`, async () => {
      vi.stubGlobal("fetch", answeringAs("Admin"));

      const { router } = await appAt(from);

      expect(router.state.location.pathname).toBe(to);
    });

    for (const role of ["Editor", "Viewer"] as const) {
      it(`shows ${aRole(role)} at ${from} the not-found screen`, async () => {
        vi.stubGlobal("fetch", answeringAs(role));

        const { router } = await openApp(from);

        expect(heading()).toBe(UNKNOWN_SCREEN.heading);
        expect(router.state.location.pathname).toBe(from);
      });
    }

    it(`shows the failed read at ${from}, no role held`, async () => {
      const clients = withTheApiDown();

      const { router } = await openApp(from, clients);
      await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

      expect(heading()).toBe(FAILED_SCREEN.heading);
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
});

describe("an address the person may not see", () => {
  it("shows a Viewer Members as not found, offering Ask (AE9)", async () => {
    vi.stubGlobal("fetch", answeringAs("Viewer"));

    const hidden = await openApp("/people/members");
    const main = screen.getByRole("main");
    await within(main).findByRole("link", { name: goHome(HOMES.Viewer) });
    const drawn = { main: main.innerHTML, banner: screen.getByRole("banner").textContent };
    hidden.rendered.unmount();

    await openApp("/people/not-a-screen");
    await within(screen.getByRole("main")).findByRole("link", { name: goHome(HOMES.Viewer) });

    expect(heading()).toBe(UNKNOWN_SCREEN.heading);
    expect(screen.getByRole("main").innerHTML).toBe(drawn.main);
    expect(screen.getByRole("banner").textContent).toBe(drawn.banner);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows an Admin Ask as not found, not their home", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));

    await openApp("/ask");

    expect(heading()).toBe(UNKNOWN_SCREEN.heading);
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

      expect(heading()).toBe(UNKNOWN_SCREEN.heading);
    });
  }

  it("shows an Admin a deeper address as not found", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));

    await openApp(`${MEMBERS.path}/${A_PERSON}/x`);

    expect(heading()).toBe(UNKNOWN_SCREEN.heading);
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

      expect(heading()).toBe(UNKNOWN_SCREEN.heading);
      expect(router.state.location.pathname).toBe(path);
    });
  }
});

describe("a role changed while the person is on a screen", () => {
  it("keeps the screen until the next move, then hides it", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));
    const { router, clients } = await openApp("/people/groups");
    expect(heading()).toBe("People");

    vi.stubGlobal("fetch", answeringAs("Editor"));
    await clients.queryClient.invalidateQueries();
    const rail = screen.getByRole("navigation", { name: RAIL });
    await within(rail).findByRole("link", { name: "Ask" });

    expect(heading()).toBe("People");
    expect(screen.getByRole("main").textContent).not.toContain(UNKNOWN_SCREEN.heading);

    await router.navigate({ href: HOMES.Editor.path });
    await router.navigate({ href: "/people/groups" });

    expect(
      await screen.findByRole("heading", { level: 1, name: UNKNOWN_SCREEN.heading }),
    ).toBeDefined();
  });
});
