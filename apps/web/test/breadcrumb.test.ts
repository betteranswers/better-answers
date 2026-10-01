import { describe, expect, it } from "vitest";

import { partsOf } from "@/app/breadcrumb.tsx";
import {
  CONSOLE,
  placeAt,
  readerOf,
  SURFACES,
  visibleTo,
  type RoleOrOperator,
} from "@/shared/navigation.ts";

const partsAt = (role: RoleOrOperator, path: string, openTab?: string) => {
  const surfaces = role === "operator" ? [CONSOLE] : SURFACES;
  const visible = visibleTo(readerOf(role), surfaces).surfaces;
  return partsOf(placeAt(visible, path), openTab);
};

describe("the band's breadcrumb", () => {
  it("names four parts, linking all but the open tab", () => {
    expect(partsAt("Admin", "/people/members", "Invitations")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "People", to: "/people/members" },
      { name: "Members", to: "/people/members" },
      { name: "Invitations", to: undefined },
    ]);
  });

  it("makes the screen current when no tab is open", () => {
    expect(partsAt("Admin", "/system/audit-log")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "System", to: "/system/audit-log" },
      { name: "Audit log", to: undefined },
    ]);
  });

  it("links a group to its first screen the reader sees", () => {
    expect(partsAt("Admin", "/people/groups")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "People", to: "/people/members" },
      { name: "Groups", to: undefined },
    ]);
  });

  it("names a tab once where it shares its screen's name", () => {
    expect(partsAt("Admin", "/people/members", "Members")).toEqual([
      { name: "Control Centre", to: "/people/members" },
      { name: "People", to: "/people/members" },
      { name: "Members", to: undefined },
    ]);
  });

  it("names Ask once, with no group part", () => {
    expect(partsAt("Viewer", "/ask")).toEqual([{ name: "Ask", to: undefined }]);
  });

  it("names the console's surface, group and screen", () => {
    expect(partsAt("operator", "/console/people/names-waiting")).toEqual([
      { name: "Console", to: "/console/workspaces/every-workspace" },
      { name: "People", to: "/console/people/everyone" },
      { name: "Names waiting", to: undefined },
    ]);
  });

  it("names nothing where the address is no screen", () => {
    expect(partsAt("Admin", "/system/not-a-screen")).toEqual([]);
  });
});
