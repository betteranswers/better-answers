import type { Page } from "@playwright/test";

import type { Role } from "@/shared/navigation.ts";
import { counted } from "@/shared/words.ts";

import { couldNotRun } from "./outcome.ts";
import { bindingsOf, membersOf, waitingInvitationsOf, type Member } from "./reads.ts";
import { stopTheRun } from "./run-stop.ts";

/** As the fixture command makes them: numbered from 01, on the test people's own domain. */
const INVENTED_MEMBERS = 51;

/** The Admin's journey moves these and puts them back, so a failed run may leave them Editors. */
const REPAIR_MEMBERS = 3;

export type TestPeople = Readonly<Record<Role, string>>;

export type Standing = {
  readonly members: readonly Pick<Member, "address" | "role">[];
  readonly waitingInvitations: number;
  readonly bindings: number;
};

/** The part after the last `@`, as the fixture command reads it: a subdomain is another domain. */
const domainOf = (address: string): string =>
  address.slice(address.lastIndexOf("@") + 1).toLowerCase();

const inventedAt = (people: TestPeople, index: number): string =>
  `invented-member-${String(index + 1).padStart(2, "0")}@${domainOf(people.Admin)}`;

const repairAddressesOf = (people: TestPeople): readonly string[] =>
  Array.from({ length: REPAIR_MEMBERS }, (_, index) => inventedAt(people, index));

/** Each address the fixture holds, with the roles it may stand in. */
const fixtureOf = (people: TestPeople): ReadonlyMap<string, readonly string[]> => {
  const invented = Array.from({ length: INVENTED_MEMBERS }, (_, index) => {
    const roles: readonly string[] = index < REPAIR_MEMBERS ? ["Viewer", "Editor"] : ["Viewer"];
    return [inventedAt(people, index), roles] as const;
  });
  const testPeople = Object.entries(people).map(([role, address]) => {
    const roles: readonly string[] = [role];
    return [address.toLowerCase(), roles] as const;
  });
  return new Map([...testPeople, ...invented]);
};

/** Counts alone, since the reason reaches the run's summary and an address must not. */
export const findingsIn = (standing: Standing, people: TestPeople): readonly string[] => {
  const fixture = fixtureOf(people);
  const rolesOf = (member: Standing["members"][number]) =>
    fixture.get(member.address.toLowerCase());
  const outside = standing.members.filter((member) => rolesOf(member) === undefined);
  const misplaced = standing.members.filter(
    (member) => rolesOf(member)?.includes(member.role) === false,
  );
  const found: readonly (readonly [number, string, string])[] = [
    [outside.length, "member outside its fixture", "members outside its fixture"],
    [
      misplaced.length,
      "member in a role its fixture does not give",
      "members in roles its fixture does not give",
    ],
    [standing.waitingInvitations, "waiting invitation", "waiting invitations"],
    [standing.bindings, "binding", "bindings"],
  ];
  return found
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => counted(count, one, many));
};

export type RepairMembers = {
  /** Display names, as the Members screen's ticks are labelled. */
  readonly names: readonly string[];
  /** Those an earlier run left as Editors. */
  readonly editors: readonly string[];
};

const repairMembersAmong = (members: readonly Member[], people: TestPeople): RepairMembers => {
  const addresses = repairAddressesOf(people);
  const repair = members.filter((member) => addresses.includes(member.address.toLowerCase()));
  if (repair.length < REPAIR_MEMBERS) {
    couldNotRun("the test workspace is missing a repair member: run the fixture command");
  }
  return {
    names: repair.map((member) => member.displayName),
    editors: repair
      .filter((member) => member.role === "Editor")
      .map((member) => member.displayName),
  };
};

/**
 * Read through the Admin's session before any act. A finding stops the run, so the Editor and
 * Viewer never sign in.
 */
export const theFixtureHolds = async (page: Page, people: TestPeople): Promise<RepairMembers> => {
  const [members, waitingInvitations, bindings] = await Promise.all([
    membersOf(page),
    waitingInvitationsOf(page),
    bindingsOf(page),
  ]);
  const findings = findingsIn({ members, waitingInvitations, bindings }, people);
  if (findings.length > 0) stopTheRun(`the test workspace holds ${findings.join(", ")}`);
  return repairMembersAmong(members, people);
};
