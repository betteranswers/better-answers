import { describe, expect, it } from "vitest";

import { jumpsIn, linesOf, matching, type JumpGroup } from "@/app/jump-to.tsx";
import { findWhat, JUMP_TO, nothingMatches } from "@/app/words.ts";
import {
  INVITE_A_PERSON,
  readerOf,
  SURFACES,
  visibleTo,
  type Role,
  type Surface,
} from "@/shared/navigation.ts";

const treeOf = (role: Role, surfaces: readonly Surface[] = SURFACES) =>
  visibleTo(readerOf(role), surfaces);

const outline = (groups: readonly JumpGroup[]) =>
  groups.map((group) => [group.heading, group.jumps.map((jump) => jump.name)]);

const valuesOf = (groups: readonly JumpGroup[]) =>
  groups.flatMap((group) => group.jumps.map((jump) => jump.value));

const PRIYA = { personId: "p1", displayName: "Priya Shah", address: "priya@example.test" };

const NAMELESS = { personId: "p2", displayName: "", address: "new@example.test" };

/** A second Priya Shah, so two members share every word a reader sees but their address. */
const ANOTHER_PRIYA = { personId: "p3", displayName: "Priya Shah", address: "ps@example.test" };

/** One surface, a built screen with an act, and an unbuilt screen with one. */
const STUB: readonly Surface[] = [
  {
    id: "yard",
    name: "Yard",
    icon: "map",
    groups: [
      {
        id: "stock",
        name: "Stock",
        screens: [
          {
            name: "Timber",
            path: "/stock/timber",
            icon: "table",
            built: true,
            seenBy: ["Admin", "Editor"],
            acts: [{ name: "Order timber", asks: "order", icon: "invite" }],
          },
          {
            name: "Steel",
            path: "/stock/steel",
            icon: "table",
            built: false,
            seenBy: ["Admin", "Editor"],
            acts: [{ name: "Order steel", asks: "order", icon: "invite" }],
          },
          {
            name: "Ledger",
            path: "/stock/ledger",
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
  it("lists a stub tree's built screens and their acts alone", () => {
    expect(outline(jumpsIn(treeOf("Admin", STUB), undefined))).toEqual([
      [JUMP_TO.groups.surfaces, ["Yard"]],
      [JUMP_TO.groups.screens, ["Timber", "Ledger"]],
      [JUMP_TO.groups.acts, ["Order timber"]],
    ]);
  });

  it("drops an act with the screen hidden from the role", () => {
    const editors = jumpsIn(treeOf("Editor", STUB), undefined);

    expect(outline(editors)).toEqual([
      [JUMP_TO.groups.surfaces, ["Yard"]],
      [JUMP_TO.groups.screens, ["Timber"]],
      [JUMP_TO.groups.acts, ["Order timber"]],
    ]);
    expect(jumpsIn(treeOf("Viewer", STUB), undefined)).toEqual([]);
  });

  it("lists a Viewer's Ask once, with no members or acts", () => {
    expect(outline(jumpsIn(treeOf("Viewer"), undefined))).toEqual([
      [JUMP_TO.groups.surfaces, ["Ask"]],
    ]);
  });

  it("lists an Admin's built screens, the invite act and members", () => {
    expect(outline(jumpsIn(treeOf("Admin"), [PRIYA, NAMELESS]))).toEqual([
      [JUMP_TO.groups.surfaces, ["Control Centre"]],
      [JUMP_TO.groups.screens, ["Bindings", "Routes and spend", "Members", "Groups", "Audit log"]],
      [JUMP_TO.groups.acts, [INVITE_A_PERSON.name]],
      [JUMP_TO.groups.members, ["Priya Shah", "new@example.test"]],
    ]);
  });

  it("gives every item its own value, namesakes included", () => {
    const values = valuesOf(jumpsIn(treeOf("Admin"), [PRIYA, ANOTHER_PRIYA, NAMELESS]));

    expect(new Set(values).size).toBe(values.length);
  });

  it("leads each item to its place, asking Members for acts", () => {
    const groups = jumpsIn(treeOf("Admin"), [PRIYA]);
    const to = Object.fromEntries(
      groups.flatMap((group) => group.jumps.map((jump) => [jump.name, jump.to])),
    );

    expect(to["Control Centre"]).toBe("/people/members");
    expect(to["Audit log"]).toBe("/system/audit-log");
    expect(to[INVITE_A_PERSON.name]).toBe("/people/members?act=invite");
    expect(to["Priya Shah"]).toBe("/people/members?search=priya%40example.test");
  });
});

describe("what typing leaves", () => {
  it("finds no People screen for a Viewer typing people (AE4)", () => {
    expect(matching(jumpsIn(treeOf("Viewer"), undefined), "people")).toEqual([]);
  });

  it("finds an Admin's People screens by their group's name", () => {
    expect(outline(matching(jumpsIn(treeOf("Admin"), [PRIYA]), "People"))).toEqual([
      [JUMP_TO.groups.screens, ["Members", "Groups"]],
    ]);
  });

  it("finds Invite a person by its first word (AE4)", () => {
    expect(outline(matching(jumpsIn(treeOf("Admin"), [PRIYA]), "invite"))).toEqual([
      [JUMP_TO.groups.acts, [INVITE_A_PERSON.name]],
    ]);
  });

  it("finds a member by name or address, every word counting", () => {
    const groups = jumpsIn(treeOf("Admin"), [PRIYA, NAMELESS]);

    expect(outline(matching(groups, "shah priya"))).toEqual([
      [JUMP_TO.groups.members, ["Priya Shah"]],
    ]);
    expect(outline(matching(groups, "NEW@"))).toEqual([
      [JUMP_TO.groups.members, ["new@example.test"]],
    ]);
  });

  it("finds nothing by an unbuilt screen's name", () => {
    expect(matching(jumpsIn(treeOf("Admin"), [PRIYA]), "Signals")).toEqual([]);
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

  it("promises a Viewer screens, an Admin members and acts too", () => {
    expect(findWhat([JUMP_TO.kinds.screen])).toBe("Find a screen");
    expect(findWhat([JUMP_TO.kinds.screen, JUMP_TO.kinds.member, JUMP_TO.kinds.act])).toBe(
      "Find a screen, a member or an act",
    );
  });
});
