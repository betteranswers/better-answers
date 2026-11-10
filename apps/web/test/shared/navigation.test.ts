import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { FAILED_PAGE, UNKNOWN_PAGE } from "@/app/words.ts";
import { CONCEPT_TYPES_PAGE } from "@/features/knowledge/curation/curation-state.ts";
import { MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";
import { aRole, ROLES } from "@/features/people/role-meanings.ts";
import {
  CONSOLE,
  CONTROL_CENTRE,
  detailAt,
  menuGroupIn,
  hides,
  HOMES,
  INBOX,
  KNOWLEDGE,
  movedWithin,
  OWNS_NOTHING,
  placeAt,
  readerOf,
  pageNamed,
  pagesOf,
  AREAS,
  visibleTo,
  type Owns,
  type Role,
  type Page,
  type Area,
} from "@/shared/navigation.ts";
import { appAt, openApp } from "@test/open-app.tsx";
import { addressOf, answeringAs, withTheApiDown } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const outline = (areas: readonly Area[]) =>
  areas.map((area) => [
    area.name,
    area.menuGroups.map((group) => [group.name ?? null, group.pages.map((each) => each.name)]),
  ]);

const withAllPagesBuilt = (area: Area): Area => ({
  id: area.id,
  name: area.name,
  icon: area.icon,
  menuGroups: area.menuGroups.map((group) => ({
    ...group,
    pages: group.pages.map((each) => ({ ...each, built: true })),
  })),
});

const groupsFor = (role: Role, owns: Owns) =>
  visibleTo(readerOf(role, owns), AREAS.map(withAllPagesBuilt)).areas.map((area) => [
    area.name,
    area.menuGroups.map((group) => group.name ?? null),
  ]);

const aPage = (name: string, built: boolean, owners?: Page["owners"]): Page => ({
  name,
  path: `/a/${name.toLowerCase()}`,
  icon: "map",
  built,
  seenBy: ["Admin"],
  ...(owners === undefined ? {} : { owners }),
});

describe("the navigation declaration", () => {
  it("declares the navigation list's areas, groups and pages in order", () => {
    expect(outline(AREAS)).toEqual([
      ["Ask", [[null, ["New Question", "Your Questions", "Connect Claude"]]]],
      [
        "Knowledge",
        [
          ["Browse", ["Search", "Guides", "Knowledge Base"]],
          [
            "Curation",
            [
              "All Knowledge",
              "Due for Verification",
              "Conflicts",
              CONCEPT_TYPES_PAGE.name,
              "Collections and Owners",
              "Exports",
            ],
          ],
        ],
      ],
      ["Inbox", [[null, ["Waiting on You"]]]],
      [
        "Control Centre",
        [
          ["Overview", ["Overview"]],
          ["Suggestions", ["To Decide"]],
          [
            "Sources",
            [
              "Connected Sources",
              "Publishing Rules",
              "Cost Estimates",
              "Backlogs",
              "Removed at Source",
              "Share Agents",
            ],
          ],
          ["Models", ["Models and Spend", "Spending Limit"]],
          ["Questions", ["Questions Asked", "Answer Tests"]],
          ["People", ["Members", "Groups", "Personal Tokens"]],
          ["Personal Data", ["Erasure and Suppression"]],
          ["System", ["Audit Log", "Signals", "Health", "Backups"]],
        ],
      ],
    ]);
  });

  it("declares the console separately, for the operator only", () => {
    expect(outline([CONSOLE])).toEqual([
      [
        "Console",
        [
          ["People", ["Everyone", "Flagged Names"]],
          ["Workspaces", ["Every Workspace"]],
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

  it("marks exactly the twenty-one current pages as built", () => {
    expect(
      pagesOf([...AREAS, CONSOLE])
        .filter((each) => each.built)
        .map((each) => each.path),
    ).toEqual([
      "/ask/new-question",
      "/ask/your-questions",
      "/ask/connect-claude",
      "/knowledge/search",
      "/knowledge/guides",
      "/knowledge/knowledge-base",
      "/knowledge/all-knowledge",
      "/knowledge/types",
      "/knowledge/collections-and-owners",
      "/knowledge/exports",
      "/inbox/waiting-on-you",
      "/sources/connected-sources",
      "/models/models-and-spend",
      "/questions/questions-asked",
      "/questions/answer-tests",
      "/people/members",
      "/people/groups",
      "/system/audit-log",
      "/console/people/everyone",
      "/console/people/names-waiting",
      "/console/workspaces/every-workspace",
    ]);
  });

  it("puts group paths at the root, console paths under /console", () => {
    const controlCentre = AREAS.find((area) => area.name === "Control Centre");
    assert(controlCentre !== undefined, "the navigation has no Control Centre area");
    const misplacedPaths = controlCentre.menuGroups.flatMap((group) =>
      group.pages.filter((each) => !each.path.startsWith(`/${group.id}`)).map((each) => each.path),
    );

    expect(misplacedPaths).toEqual([]);
    expect(pagesOf([CONSOLE]).filter((each) => !each.path.startsWith("/console/"))).toEqual([]);
  });

  it("sets the home to Members for Admins, else New Question", () => {
    expect(ROLES.map((role) => [role, HOMES[role].path])).toEqual([
      ["Admin", "/people/members"],
      ["Editor", "/ask/new-question"],
      ["Viewer", "/ask/new-question"],
    ]);
    expect(HOMES.operator.path).toBe("/console/workspaces/every-workspace");
  });

  it("gives each area a different icon", () => {
    const glyphs = [...AREAS, CONSOLE].map((area) => area.icon);

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

const ASK_OUTLINE = ["Ask", [[null, ["New Question", "Your Questions", "Connect Claude"]]]];

const OWNER_CURATION = ["All Knowledge", CONCEPT_TYPES_PAGE.name, "Collections and Owners"];

const KNOWLEDGE_WITH_OWNER_CURATION = [
  "Knowledge",
  [
    ["Browse", ["Search", "Guides", "Knowledge Base"]],
    ["Curation", OWNER_CURATION],
  ],
];

const KNOWLEDGE_WITH_ADMIN_CURATION = [
  "Knowledge",
  [
    ["Browse", ["Search", "Guides", "Knowledge Base"]],
    ["Curation", [...OWNER_CURATION, "Exports"]],
  ],
];

const INBOX_OUTLINE = ["Inbox", [[null, ["Waiting on You"]]]];

describe("the navigation each person sees", () => {
  for (const role of ["Editor", "Viewer"] as const) {
    it(`shows ${aRole(role)} Ask as home, and Knowledge`, () => {
      const shown = visibleTo(readerOf(role), AREAS);

      expect(outline(shown.areas)).toEqual([
        ["Ask", [[null, ["New Question", "Your Questions", "Connect Claude"]]]],
        ["Knowledge", [["Browse", ["Search", "Guides", "Knowledge Base"]]]],
      ]);
      expect(shown.home).toBe(HOMES[role]);
      expect(shown.areas[0]?.opensAt).toBe(HOMES[role]);
    });
  }

  it("shows an Admin Ask, Knowledge and built Control Centre pages", () => {
    const shown = visibleTo(readerOf("Admin"), AREAS);

    expect(outline(shown.areas)).toEqual([
      ASK_OUTLINE,
      KNOWLEDGE_WITH_ADMIN_CURATION,
      INBOX_OUTLINE,
      [
        "Control Centre",
        [
          ["Sources", ["Connected Sources"]],
          ["Models", ["Models and Spend"]],
          ["Questions", ["Questions Asked", "Answer Tests"]],
          ["People", ["Members", "Groups"]],
          ["System", ["Audit Log"]],
        ],
      ],
    ]);
    expect(shown.home).toBe(HOMES.Admin);
    expect(shown.areas[3]?.opensAt).toBe(HOMES.Admin);
  });

  it("shows nothing and no home before the role loads", () => {
    expect(visibleTo(readerOf(undefined), AREAS)).toEqual({
      areas: [],
      home: undefined,
    });
  });

  it("shows the operator the console, opening on Every Workspace", () => {
    const shown = visibleTo(readerOf("operator"), [CONSOLE]);

    expect(outline(shown.areas)).toEqual(outline([CONSOLE]));
    expect(shown.areas[0]?.opensAt).toBe(HOMES.operator);
    expect(visibleTo(readerOf("operator"), AREAS).areas).toEqual([]);
  });

  it("hides unbuilt groups and areas with no built groups", () => {
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

  it("shows a page to its roles and to marked owners", () => {
    const anArea: Area = {
      id: "a",
      name: "A",
      icon: "map",
      menuGroups: [
        {
          id: "g",
          name: "G",
          pages: [
            aPage("Collection's", true, "of-a-collection"),
            aPage("Anything's", true, "of-anything"),
            aPage("Roles", true),
            aPage("Later", false, "of-a-collection"),
          ],
        },
      ],
    };

    const namesFor = (role: Role, owns: Owns) =>
      pagesOf(visibleTo(readerOf(role, owns), [anArea]).areas).map((each) => each.name);

    expect(namesFor("Admin", OWNS_NOTHING)).toEqual(["Collection's", "Anything's", "Roles"]);
    expect(namesFor("Viewer", OWNS_NOTHING)).toEqual([]);
    expect(namesFor("Viewer", { collections: ["Answer"], concepts: 0 })).toEqual([
      "Collection's",
      "Anything's",
    ]);
    expect(namesFor("Viewer", { collections: [], concepts: 1 })).toEqual(["Anything's"]);
  });

  it("shows Curation and Inbox to an owner of any collection", () => {
    const owner = readerOf("Editor", { collections: ["policy"], concepts: 0 });

    expect(outline(visibleTo(owner, AREAS).areas)).toEqual([
      ASK_OUTLINE,
      KNOWLEDGE_WITH_OWNER_CURATION,
      INBOX_OUTLINE,
    ]);
  });

  it("shows an Editor who owns a collection Curation without Exports", () => {
    const owner = readerOf("Editor", { collections: ["policy"], concepts: 0 });
    const exports = pageNamed(menuGroupIn(KNOWLEDGE, "curation"), "Exports");
    const shown = visibleTo(owner, AREAS);

    expect(pagesOf(shown.areas).map((each) => each.name)).not.toContain("Exports");
    expect(hides(shown, exports.path)).toBe(true);
    expect(hides(visibleTo(readerOf("Admin"), AREAS), exports.path)).toBe(false);
  });

  it("shows Waiting on You to owners and Admins", () => {
    const waiting = pageNamed(menuGroupIn(INBOX, "inbox"), "Waiting on You");
    const { path } = waiting;
    const item = detailAt(waiting, "01JBZ6Q2V7Y9K3M5N8P0R2T4W7");
    const overrideOwner = readerOf("Viewer", { collections: [], concepts: 1 });
    const owningNothing = readerOf("Viewer", OWNS_NOTHING);
    const admin = readerOf("Admin", OWNS_NOTHING);

    expect(outline(visibleTo(overrideOwner, AREAS).areas)).toEqual([
      ASK_OUTLINE,
      ["Knowledge", [["Browse", ["Search", "Guides", "Knowledge Base"]]]],
      INBOX_OUTLINE,
    ]);
    expect(hides(visibleTo(overrideOwner, AREAS), path)).toBe(false);
    expect(hides(visibleTo(overrideOwner, AREAS), item)).toBe(false);
    expect(visibleTo(owningNothing, AREAS).areas.map((area) => area.name)).not.toContain("Inbox");
    expect(hides(visibleTo(owningNothing, AREAS), path)).toBe(true);
    expect(hides(visibleTo(owningNothing, AREAS), item)).toBe(true);
    expect(hides(visibleTo(admin, AREAS), path)).toBe(false);
  });

  it("hides Curation from an Editor owning nothing", () => {
    const owningNothing = readerOf("Editor", { collections: [], concepts: 0 });

    expect(outline(visibleTo(owningNothing, AREAS).areas)).toEqual([
      ASK_OUTLINE,
      ["Knowledge", [["Browse", ["Search", "Guides", "Knowledge Base"]]]],
    ]);
  });

  it("shows a concept owner Waiting on You but not Curation", () => {
    const owner = readerOf("Editor", { collections: [], concepts: 1 });

    expect(outline(visibleTo(owner, AREAS.map(withAllPagesBuilt)).areas)).toEqual([
      ASK_OUTLINE,
      ["Knowledge", [["Browse", ["Search", "Guides", "Knowledge Base"]]]],
      ["Inbox", [[null, ["Waiting on You"]]]],
    ]);
  });

  it("hides Curation from people who own no collection", () => {
    const path = pageNamed(menuGroupIn(KNOWLEDGE, "curation"), "Collections and Owners").path;
    const owns = { collections: ["policy"], concepts: 0 };

    expect(hides(visibleTo(readerOf("Editor", owns), AREAS), path)).toBe(false);
    expect(hides(visibleTo(readerOf("Viewer", owns), AREAS), path)).toBe(false);
    for (const role of ["Editor", "Viewer"] as const) {
      expect(hides(visibleTo(readerOf(role, { collections: [], concepts: 1 }), AREAS), path)).toBe(
        true,
      );
      expect(hides(visibleTo(readerOf(role), AREAS), path)).toBe(true);
    }
  });

  it("declares who sees each group when all pages are built", () => {
    const controlCentre = [
      "Overview",
      "Suggestions",
      "Sources",
      "Models",
      "Questions",
      "People",
      "Personal Data",
      "System",
    ];

    expect(groupsFor("Admin", OWNS_NOTHING)).toEqual([
      ["Ask", [null]],
      ["Knowledge", ["Browse", "Curation"]],
      ["Inbox", [null]],
      ["Control Centre", controlCentre],
    ]);
    for (const role of ["Editor", "Viewer"] as const) {
      expect(groupsFor(role, OWNS_NOTHING)).toEqual([
        ["Ask", [null]],
        ["Knowledge", ["Browse"]],
      ]);
      expect(groupsFor(role, { collections: ["Answer"], concepts: 0 })).toEqual([
        ["Ask", [null]],
        ["Knowledge", ["Browse", "Curation"]],
        ["Inbox", [null]],
      ]);
    }
  });
});

const MEMBERS = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members");

const A_PERSON = "01JBZ6Q2V7Y9K3M5N8P0R2T4W6";

describe("a member detail page under Members", () => {
  it("resolves a person's path to Members with the person id", () => {
    const place = placeAt(AREAS, `${MEMBERS.path}/${A_PERSON}`);

    expect(place?.page).toBe(MEMBERS);
    expect(place?.menuGroup?.name).toBe("People");
    expect(place?.detail).toBe(A_PERSON);
    expect(placeAt(AREAS, MEMBERS.path)?.detail).toBeUndefined();
  });

  it("resolves no deeper path or detail under other pages", () => {
    const resolved = [
      `${MEMBERS.path}/${A_PERSON}/x`,
      `${MEMBERS.path}/`,
      `/people/groups/${A_PERSON}`,
      `/system/audit-log/${A_PERSON}`,
    ].filter((path) => placeAt(AREAS, path) !== undefined);

    expect(resolved).toEqual([]);
  });

  it("is not listed as a page in the navigation", () => {
    const paths = pagesOf([...AREAS, CONSOLE]).map((each) => each.path);

    expect(paths.filter((path) => path.startsWith(`${MEMBERS.path}/`))).toEqual([]);
  });

  it("is hidden exactly where Members is hidden", () => {
    const path = detailAt(MEMBERS, A_PERSON);

    expect(path).toBe(`${MEMBERS.path}/${A_PERSON}`);
    expect(hides(visibleTo(readerOf("Admin"), AREAS), path)).toBe(false);
    for (const role of ["Editor", "Viewer"] as const) {
      expect(hides(visibleTo(readerOf(role), AREAS), path)).toBe(true);
    }
  });

  it("throws for a detail path under a page without details", () => {
    expect(() => detailAt(HOMES.Editor, A_PERSON)).toThrow(/declares no detail address/);
  });
});

const pageHeading = () => screen.getByRole("heading", { level: 1 }).textContent;

const NOT_FOUND = UNKNOWN_PAGE.heading;

const MOVED = [
  ["/people/audit-log", "/system/audit-log"],
  ["/system/routes-and-spend", "/models/models-and-spend"],
  ["/agent-operations/routes-and-spend", "/models/models-and-spend"],
  ["/people", "/people/members"],
  ["/sources", "/sources/connected-sources"],
  ["/sources/bindings", "/sources/connected-sources"],
  ["/system", "/system/audit-log"],
] as const;

describe("a moved path", () => {
  for (const [from, to] of MOVED) {
    it(`redirects an Admin from ${from} to ${to}`, async () => {
      vi.stubGlobal("fetch", answeringAs("Admin"));

      const { router } = await appAt(from);

      expect(router.state.location.pathname).toBe(to);
    });

    for (const role of ["Editor", "Viewer"] as const) {
      it(`shows ${aRole(role)} not found at ${from}`, async () => {
        vi.stubGlobal("fetch", answeringAs(role));

        const { router } = await openApp(from);

        expect(pageHeading()).toBe(NOT_FOUND);
        expect(router.state.location.pathname).toBe(from);
      });
    }

    it(`shows the failed page at ${from} with the api down`, async () => {
      const clients = withTheApiDown();

      const { router } = await openApp(from, clients);
      await vi.waitFor(() => expect(clients.queryClient.isFetching()).toBe(0));

      expect(pageHeading()).toBe(FAILED_PAGE.heading);
      expect(router.state.location.pathname).toBe(from);
    });
  }

  for (const role of ROLES) {
    it(`redirects ${aRole(role)} from /ask to New Question`, async () => {
      vi.stubGlobal("fetch", answeringAs(role));

      const { router } = await appAt("/ask");

      expect(router.state.location.pathname).toBe("/ask/new-question");
    });
  }

  for (const [from, to] of [
    ["/console/people", "/console/people/everyone"],
    ["/console/workspaces", "/console/workspaces/every-workspace"],
  ] as const) {
    it(`redirects the operator from ${from} to ${to}`, async () => {
      vi.stubGlobal("fetch", answeringAs("Viewer", true));

      const { router } = await appAt(from);

      expect(router.state.location.pathname).toBe(to);
    });
  }

  it("redirects every old path of a page or group", () => {
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

describe("a path the person cannot access", () => {
  it("shows a Viewer not found at Members, linking New Question", async () => {
    vi.stubGlobal("fetch", answeringAs("Viewer"));

    const hidden = await openApp("/people/members");
    const main = screen.getByRole("main");
    await within(main).findByRole("link", { name: "Go to New Question" });
    const hiddenPage = { main: main.innerHTML, banner: screen.getByRole("banner").textContent };
    hidden.rendered.unmount();

    await openApp("/people/not-a-page");
    await within(screen.getByRole("main")).findByRole("link", { name: "Go to New Question" });

    expect(pageHeading()).toBe(NOT_FOUND);
    expect(screen.getByRole("main").innerHTML).toBe(hiddenPage.main);
    expect(screen.getByRole("banner").textContent).toBe(hiddenPage.banner);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  for (const role of ["Editor", "Viewer"] as const) {
    it(`shows ${aRole(role)} not found at a member page`, async () => {
      vi.stubGlobal("fetch", answeringAs(role));

      await openApp(`${MEMBERS.path}/${A_PERSON}`);
      await within(screen.getByRole("main")).findByRole("link", { name: "Go to New Question" });

      expect(pageHeading()).toBe(NOT_FOUND);
    });
  }

  it("shows an Admin not found below a member page", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));

    await openApp(`${MEMBERS.path}/${A_PERSON}/x`);

    expect(pageHeading()).toBe(NOT_FOUND);
  });

  it("fetches no member for a malformed member id", async () => {
    const requested: string[] = [];
    const adminApi = answeringAs("Admin");
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      requested.push(addressOf(input).pathname);
      return adminApi(input);
    });

    await openApp(`${MEMBERS.path}/not-a-person`);
    await screen.findByText(MEMBER_PAGE_WORDS.noSuchMember);

    expect(pageHeading()).toBe("Members");
    expect(screen.getByRole("link", { name: "Go to Members" })).toBeDefined();
    expect(requested.filter((path) => path.includes("members."))).toEqual([]);
  });

  for (const path of ["/people/thresholds", "/suggestions/to-decide", "/knowledge/conflicts"]) {
    it(`shows an Admin not found at unbuilt ${path}`, async () => {
      vi.stubGlobal("fetch", answeringAs("Admin"));

      const { router } = await openApp(path);

      await screen.findByRole("heading", { level: 1, name: NOT_FOUND });
      expect(router.state.location.pathname).toBe(path);
    });
  }
});

describe("a role change while a page is open", () => {
  it("keeps the page until the next navigation, then hides it", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));
    const { router, clients } = await openApp("/people/groups");
    expect(pageHeading()).toBe("Groups");

    vi.stubGlobal("fetch", answeringAs("Editor"));
    await clients.queryClient.invalidateQueries();
    const rail = screen.getByRole("navigation", { name: "Areas" });
    await within(rail).findByRole("link", { name: "Ask" });

    expect(pageHeading()).toBe("Groups");
    expect(screen.getByRole("main").textContent).not.toContain(NOT_FOUND);

    await router.navigate({ href: HOMES.Editor.path });
    await router.navigate({ href: "/people/groups" });

    expect(await screen.findByRole("heading", { level: 1, name: NOT_FOUND })).toBeDefined();
  });
});
