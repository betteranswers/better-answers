import { describe, expect, it } from "vitest";

import { partsOf } from "@/app/shell/breadcrumb.tsx";
import {
  AREAS,
  CONSOLE,
  CONTROL_CENTRE,
  menuGroupIn,
  NEW_QUESTION,
  pageById,
  placeAt,
  readerOf,
  type RoleOrOperator,
  visibleTo,
} from "@/shared/navigation.ts";

const partsAt = (role: RoleOrOperator, path: string, below?: string) => {
  const areas = role === "operator" ? [CONSOLE] : AREAS;
  const visible = visibleTo(readerOf(role), areas).areas;
  return partsOf(placeAt(visible, path), below);
};

const MEMBER_PAGE = "/people/members/01JBZ6Q2V7Y9K3M5N8P0R2T4W6";

describe("the band's breadcrumb", () => {
  it("shows four parts, linking all but the open tab", () => {
    expect(partsAt("Admin", "/people/members", "Invitations")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "People", to: "/people/members" },
      { name: "Members", to: "/people/members" },
      { name: "Invitations", to: undefined },
    ]);
  });

  it("makes the page current when no tab is open", () => {
    expect(partsAt("Admin", "/system/audit-log")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "System", to: "/system/audit-log" },
      { name: pageById(menuGroupIn(CONTROL_CENTRE, "system"), "audit-log").name, to: undefined },
    ]);
  });

  it("links a group to its first page the reader sees", () => {
    expect(partsAt("Admin", "/people/groups")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "People", to: "/people/members" },
      { name: "Groups", to: undefined },
    ]);
  });

  it("leaves out a tab whose name matches its page", () => {
    expect(partsAt("Admin", "/people/members", "Members")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "People", to: "/people/members" },
      { name: "Members", to: undefined },
    ]);
  });

  it("shows Ask and its page, with no group part", () => {
    expect(partsAt("Viewer", "/ask/new-question")).toEqual([
      { name: "Ask", to: "/ask/new-question" },
      { name: NEW_QUESTION.name, to: undefined },
    ]);
  });

  it("shows the console's area, group and page", () => {
    expect(partsAt("operator", "/console/people/names-waiting")).toEqual([
      { name: "Console", to: "/console/workspaces/every-workspace" },
      { name: "People", to: "/console/people/everyone" },
      { name: pageById(menuGroupIn(CONSOLE, "people"), "flagged-names").name, to: undefined },
    ]);
  });

  it("is empty for an address that is not a page", () => {
    expect(partsAt("Admin", "/system/not-a-page")).toEqual([]);
  });

  it("shows only the given last part for an unknown address", () => {
    expect(partsAt("Admin", "/system/not-a-page", "Page Not Found")).toEqual([
      { name: "Page Not Found", to: undefined },
    ]);
  });

  it("ends a member page on the person's name", () => {
    expect(partsAt("Admin", MEMBER_PAGE, "Priya Shah")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "People", to: "/people/members" },
      { name: "Members", to: "/people/members" },
      { name: "Priya Shah", to: undefined },
    ]);
  });

  it("keeps a person's name that matches a part above", () => {
    expect(partsAt("Admin", MEMBER_PAGE, "Members").map((part) => part.name)).toEqual([
      "Control Centre",
      "People",
      "Members",
      "Members",
    ]);
  });

  it("makes Members current on a member page without a name", () => {
    expect(partsAt("Admin", MEMBER_PAGE)).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "People", to: "/people/members" },
      { name: "Members", to: undefined },
    ]);
  });
});
