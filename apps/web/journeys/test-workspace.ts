import type { Page } from "@playwright/test";

import { INVENTED_MEMBERS, inventedMemberAddress } from "@better-answers/schema/test-workspace";

import type { Role } from "@/shared/navigation.ts";
import { counted } from "@/shared/words.ts";

import { roleOfTheAdmin, standingOf, type Checked, type Member } from "./reads.ts";
import { stopTheRun } from "./run-stop.ts";

const REPAIR_MEMBERS = 3;

export type TestPeople = Readonly<Record<Role, string>>;

export type Standing = {
  readonly members: readonly Pick<Member, "address" | "role">[];
  readonly waitingInvitations: number;
  readonly connectedSources: number;
};

const domainOf = (address: string): string =>
  address.slice(address.lastIndexOf("@") + 1).toLowerCase();

const inventedAt = (people: TestPeople, index: number): string =>
  inventedMemberAddress(index + 1, domainOf(people.Admin));

const repairAddressesOf = (people: TestPeople): readonly string[] =>
  Array.from({ length: REPAIR_MEMBERS }, (_, index) => inventedAt(people, index));

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

export const findingsIn = (standing: Standing, people: TestPeople): readonly string[] => {
  const fixture = fixtureOf(people);
  const rolesOf = (member: Standing["members"][number]) =>
    fixture.get(member.address.toLowerCase());
  const outside = standing.members.filter((member) => rolesOf(member) === undefined);
  const misplaced = standing.members.filter(
    (member) => rolesOf(member)?.includes(member.role) === false,
  );
  const held = new Set(standing.members.map((member) => member.address.toLowerCase()));
  const missing = [...fixture.keys()].filter((address) => !held.has(address));
  const found: readonly (readonly [number, string, string])[] = [
    [outside.length, "member outside its fixture", "members outside its fixture"],
    [missing.length, "member of its fixture missing", "members of its fixture missing"],
    [
      misplaced.length,
      "member in a role its fixture does not give",
      "members in roles its fixture does not give",
    ],
    [standing.waitingInvitations, "waiting invitation", "waiting invitations"],
    [standing.connectedSources, "connected source", "connected sources"],
  ];
  return found
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => counted(count, one, many));
};

export type RepairMembers = {
  readonly names: readonly string[];
  readonly editors: readonly string[];
};

const repairMembersAmong = (members: readonly Member[], people: TestPeople): RepairMembers => {
  const addresses = repairAddressesOf(people);
  const repair = members.filter((member) => addresses.includes(member.address.toLowerCase()));
  return {
    names: repair.map((member) => member.displayName),
    editors: repair
      .filter((member) => member.role === "Editor")
      .map((member) => member.displayName),
  };
};

const readOrStop = <T>(checked: Checked<T>): T =>
  checked.kind === "read"
    ? checked.value
    : stopTheRun(
        `the test workspace refused the Admin's read of ${checked.procedure} (${checked.word})`,
      );

export const theFixtureHolds = async (page: Page, people: TestPeople): Promise<RepairMembers> => {
  const role = readOrStop(await roleOfTheAdmin(page));
  if (role !== "Admin") stopTheRun("the test Admin no longer holds the Admin role");
  const standing = readOrStop(await standingOf(page));
  const findings = findingsIn(standing, people);
  if (findings.length > 0) stopTheRun(`the test workspace's check found ${findings.join(", ")}`);
  return repairMembersAmong(standing.members, people);
};
