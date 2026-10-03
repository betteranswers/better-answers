import { z } from "zod";

import { boundarySchemas, INVITATION_WAITING_STATUS } from "@better-answers/schema";
import { INVENTED_MEMBERS, inventedMemberAddress } from "@better-answers/schema/test-workspace";

import { act, batchIdFor, declareActs, record } from "../audit/index.ts";
import {
  attempt,
  emailAddressOf,
  err,
  ok,
  type PlatformPrincipal,
  type Result,
  type Role,
  type UserId,
  type WorkspaceId,
  ulid,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityRead,
  withScope,
} from "../store/postgres/index.ts";
import {
  addMember,
  addPerson,
  provisionWorkspace,
  type AddMemberRefusal,
  type AddPersonRefusal,
  type ProvisionRefusal,
  type WORKSPACE_REFUSALS,
} from "../workspaces/index.ts";
import { roleWrittenByPlatform, type RoleChanged } from "./roles.ts";
import { isOffDomain, OFF_TESTING_DOMAIN } from "./testing-domain.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const MARK_ACTS = declareActs("platform", {
  marked: act("platform.workspace.marked", { corrected: "flag" }),
});

const TEST_WORKSPACE_NAME = "Test workspace";

/** Enough that a list paged at 25 runs to three pages; the journeys read the same number. */
export { INVENTED_MEMBERS };

const TESTING_DOMAIN = boundarySchemas.testWorkspaceMark.insert.shape.testingDomain;
const SLUG = boundarySchemas.workspace.insert.shape.slug;
const WORKSPACE_ID = boundarySchemas.workspace.select.shape.id;
const USER_ID = boundarySchemas.user.select.shape.id;
const ROLE = boundarySchemas.member.select.shape.role;

const MALFORMED = "malformed" satisfies MemberRefusal<"malformed">;

export type TestWorkspaceInput = {
  readonly testingDomain: string;
  readonly slug: string;
  readonly admin: string;
  readonly editor: string;
  readonly viewer: string;
};

type AddressWord = MemberRefusal<"off-testing-domain" | "operator-marked" | "member-elsewhere">;

/** Names the address, which only the operator running the fixture reads. */
type AddressRefused = { readonly word: AddressWord; readonly address: string };

type SlugTaken = Extract<keyof typeof WORKSPACE_REFUSALS, "slug-taken">;

export type TestWorkspaceRefusal =
  | AddressRefused
  | MemberRefusal<"malformed">
  | SlugTaken
  | AddPersonRefusal
  | ProvisionRefusal
  | AddMemberRefusal
  | Error;

type MarkStanding = "written" | "corrected" | "kept";

type MembersEnsured = {
  readonly membersAdded: number;
  readonly rolesReset: number;

  /** On the testing domain and outside the fixture: reported, never removed. */
  readonly unexpected: readonly { readonly address: string; readonly role: Role }[];
};

export type TestWorkspaceStanding = MembersEnsured & {
  readonly workspaceId: WorkspaceId;

  /**
   * As stored: the domain trimmed and lower-cased, the slug trimmed, so either may differ from
   * what was asked.
   */
  readonly testingDomain: string;
  readonly slug: string;
  readonly provisioned: boolean;
  readonly mark: MarkStanding;
  readonly peopleAdded: number;
};

type FixturePerson = { readonly address: string; readonly name: string; readonly role: Role };

type Fixture = {
  readonly testingDomain: string;
  readonly slug: string;
  readonly admin: FixturePerson;
  readonly others: readonly FixturePerson[];
};

type Parsed<T> = Result<T, AddressRefused | MemberRefusal<"malformed">>;

const testPersonOf = (
  asked: string,
  testingDomain: string,
  named: Omit<FixturePerson, "address">,
): Parsed<FixturePerson> => {
  const address = emailAddressOf(asked);
  if (address === undefined) return err(MALFORMED);
  if (isOffDomain(testingDomain, address)) return err({ word: OFF_TESTING_DOMAIN, address });
  return ok({ ...named, address });
};

const testPeopleOf = (
  input: TestWorkspaceInput,
  testingDomain: string,
): Parsed<Pick<Fixture, "admin" | "others">> => {
  const admin = testPersonOf(input.admin, testingDomain, { name: "Test Admin", role: "Admin" });
  const editor = testPersonOf(input.editor, testingDomain, { name: "Test Editor", role: "Editor" });
  const viewer = testPersonOf(input.viewer, testingDomain, { name: "Test Viewer", role: "Viewer" });
  if (!admin.ok) return err(admin.error);
  if (!editor.ok) return err(editor.error);
  if (!viewer.ok) return err(viewer.error);
  return ok({ admin: admin.value, others: [editor.value, viewer.value] });
};

const inventedOn = (testingDomain: string): readonly FixturePerson[] =>
  Array.from({ length: INVENTED_MEMBERS }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      address: inventedMemberAddress(index + 1, testingDomain),
      name: `Invented member ${number}`,
      role: "Viewer",
    };
  });

const fixtureOf = (input: TestWorkspaceInput): Parsed<Fixture> => {
  const testingDomain = TESTING_DOMAIN.safeParse(input.testingDomain.trim().toLowerCase());
  const slug = SLUG.safeParse(input.slug);
  if (!testingDomain.success || !slug.success) return err(MALFORMED);
  const people = testPeopleOf(input, testingDomain.data);
  if (!people.ok) return err(people.error);

  const others = [...people.value.others, ...inventedOn(testingDomain.data)];
  const everyone = [people.value.admin, ...others];
  const addresses = new Set(everyone.map((one) => one.address));
  // A long domain can pass its own check yet make an invented address too long; refuse before any write.
  const wellFormed = everyone.every((one) => emailAddressOf(one.address) !== undefined);
  if (!wellFormed || addresses.size !== everyone.length) return err(MALFORMED);
  return ok({
    testingDomain: testingDomain.data,
    slug: slug.data,
    admin: people.value.admin,
    others,
  });
};

const PERSON_ROW = z.object({
  id: USER_ID,
  address: z.string(),
  operator: z.boolean(),
  workspace_ids: z.array(z.string()),
});

type PersonStanding = z.output<typeof PERSON_ROW>;

const MEMBER_ROW = z.object({ address: z.string(), role: ROLE });

type MemberStanding = z.output<typeof MEMBER_ROW>;

type Standing = {
  readonly workspaceId: WorkspaceId | undefined;

  /** By address, each fixture person who already exists, with every workspace they belong to. */
  readonly people: ReadonlyMap<string, PersonStanding>;

  readonly members: readonly MemberStanding[];

  /** Accepting never reads the mark, so an off-domain address here could still join once marked. */
  readonly invited: readonly string[];
};

const WORKSPACE_BY_SLUG = "SELECT id FROM workspace WHERE slug = $1";

const PEOPLE_STANDING = `SELECT u.id, lower(u.email) AS address, u.operator,
                                coalesce(array_agg(m.workspace_id ORDER BY m.workspace_id)
                                           FILTER (WHERE m.workspace_id IS NOT NULL), '{}')
                                  AS workspace_ids
                           FROM "user" u LEFT JOIN member m ON m.user_id = u.id
                          WHERE lower(u.email) = ANY($1::text[])
                          GROUP BY u.id`;

const MEMBERS_STANDING = `SELECT lower(u.email) AS address, m.role
                            FROM member m JOIN "user" u ON u.id = m.user_id
                           WHERE m.workspace_id = $1
                           ORDER BY lower(u.email)`;

const membersOf = async (tx: Tx, workspaceId: WorkspaceId): Promise<readonly MemberStanding[]> =>
  z.array(MEMBER_ROW).parse((await tx.query(MEMBERS_STANDING, [workspaceId])).rows);

const INVITED_STANDING = `SELECT lower(email) AS address FROM invitation
                           WHERE workspace_id = $1 AND status = $2`;

const INVITED_ROW = z.object({ address: z.string() });

const invitedTo = async (tx: Tx, workspaceId: WorkspaceId): Promise<readonly string[]> => {
  const waiting = await tx.query(INVITED_STANDING, [workspaceId, INVITATION_WAITING_STATUS]);
  return z
    .array(INVITED_ROW)
    .parse(waiting.rows)
    .map((row) => row.address);
};

const everyoneIn = (fixture: Fixture): readonly FixturePerson[] => [
  fixture.admin,
  ...fixture.others,
];

const standingOf = (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  fixture: Fixture,
): Promise<Standing> =>
  withIdentityRead(platform, door, async (tx) => {
    const found = await tx.query<{ id: string }>(WORKSPACE_BY_SLUG, [fixture.slug]);
    const held = found.rows[0];
    const workspaceId = held === undefined ? undefined : WORKSPACE_ID.parse(held.id);
    const addresses = everyoneIn(fixture).map((one) => one.address);
    const people = z.array(PERSON_ROW).parse((await tx.query(PEOPLE_STANDING, [addresses])).rows);
    return {
      workspaceId,
      people: new Map(people.map((person) => [person.address, person])),
      members: workspaceId === undefined ? [] : await membersOf(tx, workspaceId),
      invited: workspaceId === undefined ? [] : await invitedTo(tx, workspaceId),
    };
  });

/** In the fixture's order, so the first person a refusal could name is the one named. */
const refusalOf = (
  fixture: Fixture,
  standing: Standing,
): AddressRefused | SlugTaken | undefined => {
  const people = everyoneIn(fixture).flatMap((one) => standing.people.get(one.address) ?? []);
  const operator = people.find((person) => person.operator);
  if (operator !== undefined) return { word: "operator-marked", address: operator.address };
  const elsewhere = people.find((person) =>
    person.workspace_ids.some((id) => id !== standing.workspaceId),
  );
  if (elsewhere !== undefined) return { word: "member-elsewhere", address: elsewhere.address };
  const held = [...standing.members.map((member) => member.address), ...standing.invited];
  const offDomain = (address: string) => isOffDomain(fixture.testingDomain, address);
  return held.some(offDomain) ? "slug-taken" : undefined;
};

type Held = FixturePerson & { readonly id: UserId; readonly added: boolean };

const personEnsured = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  standing: Standing,
  one: FixturePerson,
): Promise<Result<Held, AddPersonRefusal | Error>> => {
  const known = standing.people.get(one.address);
  if (known !== undefined) return ok({ ...one, id: known.id, added: false });
  const person = await addPerson(platform, door, { email: one.address, name: one.name });
  if (!person.ok) return err(person.error);
  return ok({ ...one, id: person.value.personId, added: true });
};

const peopleEnsured = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  standing: Standing,
  people: readonly FixturePerson[],
): Promise<Result<readonly Held[], AddPersonRefusal | Error>> => {
  const held: Held[] = [];
  for (const one of people) {
    const person = await personEnsured(platform, door, standing, one);
    if (!person.ok) return err(person.error);
    held.push(person.value);
  }
  return ok(held);
};

type WorkspaceEnsured = { readonly workspaceId: WorkspaceId; readonly provisioned: boolean };

const workspaceEnsured = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  slug: string,
  admin: Held,
  standing: Standing,
): Promise<Result<WorkspaceEnsured, ProvisionRefusal | Error>> => {
  if (standing.workspaceId !== undefined) {
    return ok({ workspaceId: standing.workspaceId, provisioned: false });
  }
  const provisioned = await provisionWorkspace(platform, door, {
    id: ulid(),
    name: TEST_WORKSPACE_NAME,
    slug,
    adminUserId: admin.id,
  });
  if (!provisioned.ok) return err(provisioned.error);
  return ok({ workspaceId: provisioned.value.workspaceId, provisioned: true });
};

const MARK_HELD =
  "SELECT testing_domain FROM test_workspace_mark WHERE workspace_id = $1 FOR UPDATE";

const MARK_WRITTEN = `INSERT INTO test_workspace_mark (workspace_id, testing_domain) VALUES ($1, $2)
                      ON CONFLICT (workspace_id) DO UPDATE SET testing_domain = EXCLUDED.testing_domain`;

const markEnsured = (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  testingDomain: string,
): Promise<MarkStanding> =>
  withScope(platform, door, workspaceId, async (tx) => {
    const held = await tx.query<{ testing_domain: string }>(MARK_HELD, [workspaceId]);
    const was = held.rows[0]?.testing_domain;
    if (was === testingDomain) return "kept";

    await tx.query(MARK_WRITTEN, [workspaceId, testingDomain]);
    await record(platform, tx, {
      id: ulid(),
      act: MARK_ACTS.marked,
      subjectId: workspaceId,
      detail: { corrected: was !== undefined },
    });
    return was === undefined ? "written" : "corrected";
  });

const membersAdded = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  missing: readonly Held[],
): Promise<Result<undefined, AddMemberRefusal | Error>> => {
  for (const one of missing) {
    const added = await addMember(platform, door, {
      workspaceId,
      email: one.address,
      role: one.role,
    });
    if (!added.ok) return err(added.error);
  }
  return ok(undefined);
};

const rolesReset = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  drifted: readonly RoleChanged[],
): Promise<number> => {
  if (drifted.length === 0) return 0;
  const batchId = batchIdFor(drifted.length);
  return withScope(platform, door, workspaceId, async (tx) => {
    let reset = 0;
    for (const changed of drifted) {
      if (await roleWrittenByPlatform(platform, tx, workspaceId, changed, batchId)) reset += 1;
    }
    return reset;
  });
};

const driftedAmong = (
  everyone: readonly Held[],
  roles: ReadonlyMap<string, Role>,
): readonly RoleChanged[] =>
  everyone.flatMap((one) => {
    const previousRole = roles.get(one.address);
    if (previousRole === undefined || previousRole === one.role) return [];
    return [{ personId: one.id, previousRole, role: one.role }];
  });

/** The Admin comes first, so no reset leaves the workspace without one. */
const membersEnsured = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  everyone: readonly Held[],
): Promise<Result<MembersEnsured, AddMemberRefusal | Error>> => {
  const standing = await attempt(() =>
    withIdentityRead(platform, door, (tx) => membersOf(tx, workspaceId)),
  );
  if (!standing.ok) return err(standing.error);
  const roles = new Map(standing.value.map((member) => [member.address, member.role]));
  const missing = everyone.filter((one) => !roles.has(one.address));
  const drifted = driftedAmong(everyone, roles);

  const added = await membersAdded(platform, door, workspaceId, missing);
  if (!added.ok) return err(added.error);
  const reset = await attempt(() => rolesReset(platform, door, workspaceId, drifted));
  if (!reset.ok) return err(reset.error);

  const inFixture = new Set(everyone.map((one) => one.address));
  return ok({
    membersAdded: missing.length,
    rolesReset: reset.value,
    unexpected: standing.value.filter((member) => !inFixture.has(member.address)),
  });
};

/**
 * Each step is an existing act with its own transaction; a failure leaves what landed, and a
 * re-run repairs from there.
 */
const fixtureWritten = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  fixture: Fixture,
  standing: Standing,
): Promise<Result<TestWorkspaceStanding, TestWorkspaceRefusal>> => {
  const admin = await personEnsured(platform, door, standing, fixture.admin);
  if (!admin.ok) return err(admin.error);
  const others = await peopleEnsured(platform, door, standing, fixture.others);
  if (!others.ok) return err(others.error);
  const workspace = await workspaceEnsured(platform, door, fixture.slug, admin.value, standing);
  if (!workspace.ok) return err(workspace.error);
  const { workspaceId, provisioned } = workspace.value;

  const mark = await attempt(() => markEnsured(platform, door, workspaceId, fixture.testingDomain));
  if (!mark.ok) return err(mark.error);
  const everyone = [admin.value, ...others.value];
  const members = await membersEnsured(platform, door, workspaceId, everyone);
  if (!members.ok) return err(members.error);
  const peopleAdded = everyone.filter((one) => one.added).length;
  const { testingDomain, slug } = fixture;
  const written = { workspaceId, testingDomain, slug, provisioned, mark: mark.value, peopleAdded };
  return ok({ ...written, ...members.value });
};

/**
 * Creates or repairs the test workspace, its mark, three test people and 51 invented Viewers.
 * Before writing anything it refuses an address off the testing domain, the operator's or a
 * member's elsewhere, and a slug whose workspace holds a member or waiting invitation off it.
 * It removes nobody.
 */
export const ensureTestWorkspace = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: TestWorkspaceInput,
): Promise<Result<TestWorkspaceStanding, TestWorkspaceRefusal>> => {
  const fixture = fixtureOf(input);
  if (!fixture.ok) return err(fixture.error);
  const standing = await attempt(() => standingOf(platform, door, fixture.value));
  if (!standing.ok) return err(standing.error);
  const refused = refusalOf(fixture.value, standing.value);
  if (refused !== undefined) return err(refused);
  return fixtureWritten(platform, door, fixture.value, standing.value);
};
