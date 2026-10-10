import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jumpsIn, linesOf, matching, searchGroup, type JumpGroup } from "@/app/jump-to.tsx";
import { findWhat, JUMP_TO, nothingMatches } from "@/app/words.ts";
import {
  CONSOLE,
  INVITE_A_PERSON,
  readerOf,
  AREAS,
  visibleTo,
  type Role,
  type Area,
} from "@/shared/navigation.ts";

import { openApp } from "./open-app.tsx";
import { answeringAs } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const treeOf = (role: Role, areas: readonly Area[] = AREAS) => visibleTo(readerOf(role), areas);

const outline = (groups: readonly JumpGroup[]) =>
  groups.map((group) => [group.heading, group.jumps.map((jump) => jump.name)]);

const valuesOf = (groups: readonly JumpGroup[]) =>
  groups.flatMap((group) => group.jumps.map((jump) => jump.value));

/** Open on no page an action or a member asks, so no query carries into a jump. */
const AT_ROOT = { pathname: "/", searchStr: "" };

const PRIYA = { personId: "p1", displayName: "Priya Shah", address: "priya@example.test" };

const NAMELESS = { personId: "p2", displayName: "", address: "new@example.test" };

/** A second Priya Shah, so two members share every word a reader sees but their address. */
const ANOTHER_PRIYA = { personId: "p3", displayName: "Priya Shah", address: "ps@example.test" };

/** One area, a built page with an action, and an unbuilt page with one. */
const STUB: readonly Area[] = [
  {
    id: "yard",
    name: "Yard",
    icon: "map",
    menuGroups: [
      {
        id: "stock",
        name: "Stock",
        pages: [
          {
            name: "Timber",
            path: "/stock/timber",
            icon: "table",
            built: true,
            seenBy: ["Admin", "Editor"],
            actions: [{ name: "Order timber", asks: "order", icon: "invite" }],
          },
          {
            name: "Steel",
            path: "/stock/steel",
            icon: "table",
            built: false,
            seenBy: ["Admin", "Editor"],
            actions: [{ name: "Order steel", asks: "order", icon: "invite" }],
          },
          {
            name: "Deliveries",
            path: "/stock/deliveries",
            icon: "log",
            built: true,
            seenBy: ["Admin"],
          },
        ],
      },
    ],
  },
];

describe("what jump-to lists", () => {
  it("lists a stub tree's built pages and their actions alone", () => {
    expect(outline(jumpsIn(treeOf("Admin", STUB), undefined, AT_ROOT))).toEqual([
      ["Areas", ["Yard"]],
      ["Pages", ["Timber", "Deliveries"]],
      [JUMP_TO.groups.actions, ["Order timber"]],
    ]);
  });

  it("drops an action with the page hidden from the role", () => {
    const editors = jumpsIn(treeOf("Editor", STUB), undefined, AT_ROOT);

    expect(outline(editors)).toEqual([
      [JUMP_TO.groups.areas, ["Yard"]],
      [JUMP_TO.groups.pages, ["Timber"]],
      [JUMP_TO.groups.actions, ["Order timber"]],
    ]);
    expect(jumpsIn(treeOf("Viewer", STUB), undefined, AT_ROOT)).toEqual([]);
  });

  it("lists a Viewer's Ask once, with no members or actions", () => {
    expect(outline(jumpsIn(treeOf("Viewer"), undefined, AT_ROOT))).toEqual([
      [JUMP_TO.groups.areas, ["Ask", "Knowledge"]],
      [JUMP_TO.groups.pages, ["Search"]],
    ]);
  });

  it("lists an Admin's built pages, the invite action and members", () => {
    expect(outline(jumpsIn(treeOf("Admin"), [PRIYA, NAMELESS], AT_ROOT))).toEqual([
      [JUMP_TO.groups.areas, ["Knowledge", "Control Centre"]],
      [
        JUMP_TO.groups.pages,
        ["Search", "Connected sources", "Models and spend", "Members", "Groups", "Audit log"],
      ],
      [JUMP_TO.groups.actions, [INVITE_A_PERSON.name]],
      [JUMP_TO.groups.members, ["Priya Shah", "new@example.test"]],
    ]);
  });

  it("gives every item its own value, namesakes included", () => {
    const values = valuesOf(jumpsIn(treeOf("Admin"), [PRIYA, ANOTHER_PRIYA, NAMELESS], AT_ROOT));

    expect(new Set(values).size).toBe(values.length);
  });

  it("leads each item to its place, asking Members for actions", () => {
    const groups = jumpsIn(treeOf("Admin"), [PRIYA], AT_ROOT);
    const to = Object.fromEntries(
      groups.flatMap((group) => group.jumps.map((jump) => [jump.name, jump.to])),
    );

    expect(to["Control Centre"]).toBe("/people/members");
    expect(to["Audit log"]).toBe("/system/audit-log");
    expect(to[INVITE_A_PERSON.name]).toBe("/people/members?action=invite");
  });

  it("leads a member to their page from anywhere", () => {
    const narrowed = {
      pathname: "/people/members",
      searchStr: "?members.role=Viewer&members.page=3&invitations.search=ops",
    };
    const toOf = (here: typeof AT_ROOT) =>
      jumpsIn(treeOf("Admin"), [PRIYA], here)
        .flatMap((group) => group.jumps)
        .find((jump) => jump.name === "Priya Shah")?.to;

    expect(toOf(AT_ROOT)).toBe("/people/members/p1");
    expect(toOf(narrowed)).toBe("/people/members/p1");
  });

  it("keeps Members' list filters when asking Members for an action", () => {
    const filtered = { pathname: "/people/members", searchStr: "?members.role=Editor" };
    const elsewhere = { pathname: "/people/groups", searchStr: "?groups.search=ops" };
    const toOf = (here: typeof filtered) =>
      jumpsIn(treeOf("Admin"), [PRIYA], here)
        .flatMap((group) => group.jumps)
        .find((jump) => jump.name === INVITE_A_PERSON.name)?.to;

    expect(toOf(filtered)).toBe("/people/members?members.role=Editor&action=invite");
    expect(toOf(elsewhere)).toBe("/people/members?action=invite");
  });
});

/** jsdom has none, and the dialog's list watches its own size with one. */
class Unmeasured {
  observe = vi.fn<() => void>();
  unobserve = vi.fn<() => void>();
  disconnect = vi.fn<() => void>();
}

describe("choosing Invite a person in the app", () => {
  // jsdom lays nothing out, and the list scrolls the chosen item into view.
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: vi.fn<() => void>(),
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("keeps Members' list filters in the address", async () => {
    vi.stubGlobal("fetch", answeringAs("Admin"));
    vi.stubGlobal("ResizeObserver", Unmeasured);
    const { router } = await openApp("/people/members?members.role=Editor");
    await screen.findByRole("button", { name: JUMP_TO.name });

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(INVITE_A_PERSON.name) }));

    expect(await screen.findByRole("dialog", { name: INVITE_A_PERSON.name })).toBeDefined();
    await vi.waitFor(() =>
      expect(router.state.location.href).toBe("/people/members?members.role=Editor"),
    );
  });
});

describe("what typing leaves", () => {
  it("finds no People page for a Viewer typing people", () => {
    expect(matching(jumpsIn(treeOf("Viewer"), undefined, AT_ROOT), "people")).toEqual([]);
  });

  it("finds an Admin's People pages by their group's name", () => {
    expect(outline(matching(jumpsIn(treeOf("Admin"), [PRIYA], AT_ROOT), "People"))).toEqual([
      [JUMP_TO.groups.pages, ["Members", "Groups"]],
    ]);
  });

  it("finds Invite a person by its first word", () => {
    expect(outline(matching(jumpsIn(treeOf("Admin"), [PRIYA], AT_ROOT), "invite"))).toEqual([
      [JUMP_TO.groups.actions, [INVITE_A_PERSON.name]],
    ]);
  });

  it("finds a member by name or address, every word counting", () => {
    const groups = jumpsIn(treeOf("Admin"), [PRIYA, NAMELESS], AT_ROOT);

    expect(outline(matching(groups, "shah priya"))).toEqual([
      [JUMP_TO.groups.members, ["Priya Shah"]],
    ]);
    expect(outline(matching(groups, "NEW@"))).toEqual([
      [JUMP_TO.groups.members, ["new@example.test"]],
    ]);
  });

  it("finds nothing by an unbuilt page's name", () => {
    expect(matching(jumpsIn(treeOf("Admin"), [PRIYA], AT_ROOT), "Signals")).toEqual([]);
  });
});

describe("what jump-to offers to search", () => {
  /** Each row's name and where it leads, under its heading. */
  const offered = (group: JumpGroup | undefined) =>
    group === undefined
      ? undefined
      : [group.heading, group.jumps.map((jump) => [jump.name, jump.to])];

  it("asks Search for what was typed", () => {
    expect(offered(searchGroup(treeOf("Viewer"), "audit logs", AT_ROOT))).toEqual([
      "Knowledge",
      [["Search for “audit logs”", "/knowledge/search?search=audit+logs"]],
    ]);
  });

  it("offers no search with nothing typed", () => {
    expect(searchGroup(treeOf("Viewer"), "", AT_ROOT)).toBeUndefined();
  });

  it("offers no search for spaces alone", () => {
    expect(searchGroup(treeOf("Viewer"), "  \t ", AT_ROOT)).toBeUndefined();
  });

  it("offers no search to a reader with no Search", () => {
    const operators = visibleTo(readerOf("operator"), [CONSOLE]);

    expect(searchGroup(treeOf("Admin", STUB), "audit logs", AT_ROOT)).toBeUndefined();
    expect(searchGroup(operators, "audit logs", AT_ROOT)).toBeUndefined();
  });

  it("drops the spaces around what was typed", () => {
    expect(offered(searchGroup(treeOf("Admin"), "  audit logs ", AT_ROOT))).toEqual([
      "Knowledge",
      [["Search for “audit logs”", "/knowledge/search?search=audit+logs"]],
    ]);
  });

  it("keeps Search's own query when asked from Search", () => {
    const onSearch = { pathname: "/knowledge/search", searchStr: "?knowledge.search=forklift" };

    expect(offered(searchGroup(treeOf("Editor"), "audit", onSearch))?.[1]).toEqual([
      ["Search for “audit”", "/knowledge/search?knowledge.search=forklift&search=audit"],
    ]);
  });
});

describe("what the dialog's outcome line says", () => {
  it("says the members are loading, never that nothing matches", () => {
    expect(linesOf("pending", 0, "zzz")).toEqual({ said: JUMP_TO.membersLoading });
  });

  it("says nothing matches once every group has loaded", () => {
    expect(linesOf("read", 0, " zzz ")).toEqual({ said: nothingMatches("zzz") });
    expect(linesOf("unasked", 0, "zzz")).toEqual({ said: nothingMatches("zzz") });
  });

  it("says nothing while something matches", () => {
    expect(linesOf("read", 3, "pri")).toEqual({});
    expect(linesOf("read", 9, "")).toEqual({});
  });

  it("refuses a failed read beside what still matches", () => {
    expect(linesOf("failed", 2, "inv")).toEqual({ refused: JUMP_TO.membersUnread });
    expect(linesOf("failed", 0, "zzz")).toEqual({
      said: nothingMatches("zzz"),
      refused: JUMP_TO.membersUnread,
    });
  });

  it("promises a Viewer pages, an Admin members and actions too", () => {
    expect(findWhat([JUMP_TO.kinds.page])).toBe("Find a page");
    expect(findWhat([JUMP_TO.kinds.page, JUMP_TO.kinds.member, JUMP_TO.kinds.action])).toBe(
      "Find a page, a member or an action",
    );
  });
});
