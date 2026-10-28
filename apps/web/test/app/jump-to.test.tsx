import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jumpsIn, linesOf, matching, searchGroup, type JumpGroup } from "@/app/jump-to.tsx";
import { findWhat, JUMP_TO } from "@/app/words.ts";
import { CONSOLE, readerOf, AREAS, visibleTo, type Role, type Area } from "@/shared/navigation.ts";
import { nothingMatches } from "@/shared/words.ts";
import { openApp } from "@test/open-app.tsx";
import { answeringAs } from "@test/stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const treeOf = (role: Role, areas: readonly Area[] = AREAS) => visibleTo(readerOf(role), areas);

const outline = (groups: readonly JumpGroup[]) =>
  groups.map((group) => [group.heading, group.jumps.map((jump) => jump.name)]);

const valuesOf = (groups: readonly JumpGroup[]) =>
  groups.flatMap((group) => group.jumps.map((jump) => jump.value));

const AT_ROOT = { pathname: "/", searchStr: "" };

const PRIYA = { personId: "p1", displayName: "Priya Shah", address: "priya@example.test" };

const NAMELESS = { personId: "p2", displayName: "", address: "new@example.test" };

const ANOTHER_PRIYA = { personId: "p3", displayName: "Priya Shah", address: "ps@example.test" };

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

const INVITE = "Invite a Person";

describe("what jump-to lists", () => {
  it("lists a stub tree's built pages and their actions alone", () => {
    expect(outline(jumpsIn(treeOf("Admin", STUB), undefined, AT_ROOT))).toEqual([
      ["Areas", ["Yard"]],
      ["Pages", ["Timber", "Deliveries"]],
      ["Actions", ["Order timber"]],
    ]);
  });

  it("drops an action with the page hidden from the role", () => {
    const editors = jumpsIn(treeOf("Editor", STUB), undefined, AT_ROOT);

    expect(outline(editors)).toEqual([
      ["Areas", ["Yard"]],
      ["Pages", ["Timber"]],
      ["Actions", ["Order timber"]],
    ]);
    expect(jumpsIn(treeOf("Viewer", STUB), undefined, AT_ROOT)).toEqual([]);
  });

  it("lists a Viewer's areas and pages, no members or actions", () => {
    expect(outline(jumpsIn(treeOf("Viewer"), undefined, AT_ROOT))).toEqual([
      ["Areas", ["Ask", "Knowledge"]],
      ["Pages", ["New Question", "Your Questions", "Connect Claude", "Search", "Knowledge Base"]],
    ]);
  });

  it("lists an Admin's built pages, the invite action and members", () => {
    expect(outline(jumpsIn(treeOf("Admin"), [PRIYA, NAMELESS], AT_ROOT))).toEqual([
      ["Areas", ["Ask", "Knowledge", "Inbox", "Control Centre"]],
      [
        "Pages",
        [
          "New Question",
          "Your Questions",
          "Connect Claude",
          "Search",
          "Knowledge Base",
          "Collections and Owners",
          "Waiting on You",
          "Connected Sources",
          "Models and Spend",
          "Questions Asked",
          "Answer Tests",
          "Members",
          "Groups",
          "Audit Log",
        ],
      ],
      ["Actions", [INVITE]],
      ["Members", ["Priya Shah", "new@example.test"]],
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
    expect(to["Audit Log"]).toBe("/system/audit-log");
    expect(to[INVITE]).toBe("/people/members?action=invite");
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
        .find((jump) => jump.name === INVITE)?.to;

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
    await screen.findByRole("button", { name: "Jump To" });

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(INVITE) }));

    expect(await screen.findByRole("dialog", { name: INVITE })).toBeDefined();
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
      ["Pages", ["Members", "Groups"]],
    ]);
  });

  it("finds Invite a person by its first word", () => {
    expect(outline(matching(jumpsIn(treeOf("Admin"), [PRIYA], AT_ROOT), "invite"))).toEqual([
      ["Actions", [INVITE]],
    ]);
  });

  it("finds a member by name or address, every word counting", () => {
    const groups = jumpsIn(treeOf("Admin"), [PRIYA, NAMELESS], AT_ROOT);

    expect(outline(matching(groups, "shah priya"))).toEqual([["Members", ["Priya Shah"]]]);
    expect(outline(matching(groups, "NEW@"))).toEqual([["Members", ["new@example.test"]]]);
  });

  it("finds nothing by an unbuilt page's name", () => {
    expect(matching(jumpsIn(treeOf("Admin"), [PRIYA], AT_ROOT), "Signals")).toEqual([]);
  });
});

describe("what jump-to offers to search", () => {
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

  it.each([
    ["1.50", "%221.50%22"],
    ["1e3", "%221e3%22"],
    ['"audit logs"', "%22%5C%22audit+logs%5C%22%22"],
  ])("asks for %s whole, though it reads as JSON", (typed, held) => {
    const asked = searchGroup(treeOf("Viewer"), typed, AT_ROOT)?.jumps.map((jump) => jump.to);

    expect(asked).toEqual([`/knowledge/search?search=${held}`]);
  });

  it("asks for no more than Search takes", () => {
    const asked = offered(searchGroup(treeOf("Viewer"), `${"a".repeat(500)}bcd`, AT_ROOT));

    expect(asked?.[1]).toEqual([
      [`Search for “${"a".repeat(500)}”`, `/knowledge/search?search=${"a".repeat(500)}`],
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
    const { page, member, action } = JUMP_TO.kinds;
    const forAViewer = findWhat([page]);
    const forAnAdmin = findWhat([page, member, action]);
    const placed = [page, member, action].map((kind) => forAnAdmin.indexOf(kind));

    expect(forAViewer).toContain(page);
    expect(forAViewer).not.toContain(member);
    expect(forAViewer).not.toContain(action);
    expect(placed).not.toContain(-1);
    expect(placed).toEqual(placed.toSorted((one, next) => one - next));
  });
});
