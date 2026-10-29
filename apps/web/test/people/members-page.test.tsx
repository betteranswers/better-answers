import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { server } from "@test/stub-server.ts";
import { ADA, adaAnAdmin, adaAt, GRACE, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const people = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS_PAGE = pageNamed(people, "Members").path;

const GROUPS_PAGE = pageNamed(people, "Groups").path;

const idOf = (seed: string): string => `01J${seed}`.padEnd(26, "0");

const PRIYA = {
  ...GRACE,
  personId: idOf("PRYA"),
  displayName: "Priya Shah",
  address: "priya@calder.example.test",
  role: "Editor",
};

const SAM = {
  ...GRACE,
  personId: idOf("SAM"),
  displayName: "Sam Okoro",
  address: "sam@calder.example.test",
  role: "Viewer",
  joinedAt: "2026-04-17T09:00:00.000Z",
};

const TEST_PERSON = { ...ADA, displayName: "Test person", address: "admin@calder.example.test" };

const A_STRANGER = {
  ...GRACE,
  personId: idOf("STRNGR"),
  displayName: "Una Elsewhere",
  address: "stranger@elsewhere.example.test",
};

const control = () => screen.getByRole("navigation", { name: "Control Centre" });

const membersRegion = () => screen.getByRole("region", { name: "Members" });

const memberRows = () =>
  within(membersRegion())
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("cell").length > 0);

const rowOf = (name: string) => {
  const row = memberRows().find((each) => each.textContent.includes(name));
  expect(row, `no row for ${name}`).toBeDefined();
  return row ?? document.body;
};

const COLUMN = { Person: 1, Role: 2, Groups: 3, Joined: 4 } as const;

const cellOf = (name: string, column: keyof typeof COLUMN): string =>
  within(rowOf(name)).getAllByRole("cell")[COLUMN[column]]?.textContent ?? "";

const theThree = () => {
  const api = adaAnAdmin();
  api.set("members.list", () => read([PRIYA, SAM, TEST_PERSON]));
  return api;
};

describe("the People group's Members page", () => {
  it("opens People on Members, and no page is called Roles", async () => {
    const router = await openAt(GROUPS_PAGE, theThree());

    fireEvent.click(within(control()).getByRole("link", { name: "Members" }));

    await screen.findByRole("tab", { name: "Members" });
    expect(router.state.location.pathname).toBe(MEMBERS_PAGE);
    expect(within(control()).getByRole("link", { name: "Members" })).toBeDefined();
    expect(within(control()).getByRole("link", { name: "Groups" })).toBeDefined();
    expect(within(control()).queryAllByRole("link", { name: "Roles" })).toHaveLength(0);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Members",
      "Invitations",
      "Requests",
    ]);
    expect(screen.getByRole("tab", { name: "Members" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows an Admin each member's details, and no one else's", async () => {
    await openAt(MEMBERS_PAGE, theThree());

    await screen.findByRole("link", { name: PRIYA.displayName });
    expect(memberRows()).toHaveLength(3);
    expect(within(membersRegion()).getAllByRole("status")[0]?.textContent).toMatch(/\b3\b/);
    for (const member of [PRIYA, SAM]) {
      expect(rowOf(member.displayName).textContent).toContain(member.address);
      expect(cellOf(member.displayName, "Role")).toBe(member.role);
      expect(cellOf(member.displayName, "Groups")).toBe("No group");
    }
    expect(cellOf(TEST_PERSON.displayName, "Role")).toBe("Admin");
    expect(cellOf(TEST_PERSON.displayName, "Joined")).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    expect(cellOf(SAM.displayName, "Joined")).toBe("17 April 2026");
  });

  it("shows an Editor Members as not found, listing no one", async () => {
    const api = theThree();
    api.set("session.member", () => adaAt("Editor"));
    api.set("members.list", () => read([PRIYA, SAM, TEST_PERSON, A_STRANGER]));

    const router = await openAt(MEMBERS_PAGE, api);

    const main = screen.getByRole("main");
    await within(main).findByRole("link", { name: "Go to New Question" });
    expect(router.state.location.pathname).toBe(MEMBERS_PAGE);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page Not Found");
    expect(screen.queryByRole("region", { name: "Members" })).toBeNull();
    expect(document.body.textContent).not.toContain(TEST_PERSON.address);
    expect(server.asks.map((ask) => ask.procedure)).not.toContain("members.list");
  });
});
