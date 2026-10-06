// @vitest-environment node

import { describe, expect, it } from "vitest";

import { INVENTED_MEMBERS, inventedMemberAddress } from "@better-answers/schema/test-workspace";

// oxlint-disable-next-line no-restricted-imports -- the journeys sit outside `src`, where no alias reaches
import { findingsIn, type Standing, type TestPeople } from "../journeys/test-workspace.ts";

const PEOPLE: TestPeople = {
  Admin: "Admin@Journeys.example",
  Editor: "editor@journeys.example",
  Viewer: "viewer@journeys.example",
};

const invented = (number: number, role = "Viewer") => ({
  address: inventedMemberAddress(number, "journeys.example"),
  role,
});

/** The fixture as the command leaves it, from the shape it shares with the journeys. */
const FIXTURE: Standing["members"] = [
  { address: "admin@journeys.example", role: "Admin" },
  { address: "editor@journeys.example", role: "Editor" },
  { address: "viewer@journeys.example", role: "Viewer" },
  ...Array.from({ length: INVENTED_MEMBERS }, (_, index) => invented(index + 1)),
];

const standing = (changed: Partial<Standing> = {}): Standing => ({
  members: FIXTURE,
  waitingInvitations: 0,
  connectedSources: 0,
  ...changed,
});

const withMember = (number: number, role: string): Standing["members"] =>
  FIXTURE.map((member) =>
    member.address === invented(number).address ? { ...member, role } : member,
  );

describe("the check of the test workspace", () => {
  it("finds nothing in the fixture as the command leaves it", () => {
    expect(findingsIn(standing(), PEOPLE)).toEqual([]);
  });

  it("finds nothing in a repair member left as an Editor", () => {
    expect(findingsIn(standing({ members: withMember(3, "Editor") }), PEOPLE)).toEqual([]);
  });

  it("counts an invented member made an Admin", () => {
    expect(findingsIn(standing({ members: withMember(1, "Admin") }), PEOPLE)).toEqual([
      "1 member in a role its fixture does not give",
    ]);
  });

  it("counts the fourth invented member made an Editor", () => {
    expect(findingsIn(standing({ members: withMember(4, "Editor") }), PEOPLE)).toEqual([
      "1 member in a role its fixture does not give",
    ]);
  });

  it("counts a test person in another person's role", () => {
    const members = FIXTURE.map((member) =>
      member.address === "viewer@journeys.example" ? { ...member, role: "Editor" } : member,
    );

    expect(findingsIn(standing({ members }), PEOPLE)).toEqual([
      "1 member in a role its fixture does not give",
    ]);
  });

  it("counts a missing invented member", () => {
    const members = FIXTURE.filter((member) => member.address !== invented(30).address);

    expect(findingsIn(standing({ members }), PEOPLE)).toEqual(["1 member of its fixture missing"]);
  });

  it("counts missing repair members and a missing test person", () => {
    const gone = new Set([invented(2).address, invented(3).address, "editor@journeys.example"]);
    const members = FIXTURE.filter((member) => !gone.has(member.address));

    expect(findingsIn(standing({ members }), PEOPLE)).toEqual(["3 members of its fixture missing"]);
  });

  it("counts outsiders, invitations and connected sources, naming no address", () => {
    const members = [
      ...FIXTURE,
      { address: "stranger@elsewhere.example", role: "Viewer" },
      { address: "invented-member-52@journeys.example", role: "Viewer" },
      { address: "invented-member-01@elsewhere.example", role: "Viewer" },
    ];

    const found = findingsIn(
      standing({ members, waitingInvitations: 1, connectedSources: 2 }),
      PEOPLE,
    );

    expect(found).toEqual([
      "3 members outside its fixture",
      "1 waiting invitation",
      "2 connected sources",
    ]);
    expect(found.join(" ")).not.toContain("@");
  });
});
