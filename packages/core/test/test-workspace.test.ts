import { describe, expect, expectTypeOf, it } from "vitest";

import {
  INVITATION_CANCELLED_STATUS,
  INVITATION_WAITING_STATUS,
  ulid,
} from "@better-answers/schema";

import type { PlatformPrincipal, Result, UserPrincipal, WorkspaceId } from "../src/kernel/index.ts";
import {
  changeRole,
  ensureTestWorkspace,
  inviteMembers,
  inviteMembersInput,
  removeMember,
} from "../src/members/index.ts";
import { openPostgres, type Tx } from "../src/store/postgres/index.ts";
import { answeredValue, ULID } from "./invitations-suite.ts";
import { heldAs } from "./members-suite.ts";
import {
  bootstrap,
  personIdOf,
  provisionedWorkspace,
  type ProvisionedWorkspace,
} from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { postgresForSuite, seedingWith, until } from "./suite-postgres.ts";

const db = postgresForSuite();

const BOOTSTRAP_ACTOR = "process:better-answers-bootstrap";

const aFixture = () => {
  const testingDomain = `${ulid().toLowerCase()}.testing.invalid`;
  return {
    testingDomain,
    slug: `journeys-${ulid().toLowerCase()}`,
    admin: `admin@${testingDomain}`,
    editor: `editor@${testingDomain}`,
    viewer: `viewer@${testingDomain}`,
  };
};

type Fixture = ReturnType<typeof aFixture>;

const ensured = (fixture: Fixture) =>
  ensureTestWorkspace(bootstrap, openPostgres(db().runtimePool), fixture);

const inventedAt = (fixture: Fixture, number: string): string =>
  `invented-member-${number}@${fixture.testingDomain}`;

const membersOf = async (workspaceId: string) =>
  (
    await db().pool.query<{ address: string; role: string }>(
      `SELECT lower(u.email) AS address, m.role FROM member m JOIN "user" u ON u.id = m.user_id
        WHERE m.workspace_id = $1 ORDER BY lower(u.email)`,
      [workspaceId],
    )
  ).rows;

const peopleOn = async (fixture: Fixture) =>
  (
    await db().pool.query<{ id: string; address: string; name: string; operator: boolean }>(
      `SELECT id, lower(email) AS address, name, operator FROM "user"
        WHERE lower(email) LIKE $1 ORDER BY lower(email)`,
      [`%@${fixture.testingDomain}`],
    )
  ).rows;

const personIdAt = async (address: string) => {
  const found = await db().pool.query<{ id: string }>(
    'SELECT id FROM "user" WHERE lower(email) = $1',
    [address],
  );
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error(`no person holds ${address}`);
  return personIdOf(id);
};

const invitationsLeftIn = (
  workspace: ProvisionedWorkspace,
  rows: readonly { readonly email: string; readonly status: string }[],
) =>
  seedingWith(db().pool, async (seed) => {
    for (const row of rows) {
      await seed.invitation({
        ...row,
        workspaceId: workspace.workspaceId,
        inviterId: workspace.adminUserId,
      });
    }
  });

const workspacesWithSlug = async (slug: string) =>
  (await db().pool.query("SELECT id FROM workspace WHERE slug = $1", [slug])).rows;

const markOf = async (workspaceId: string) =>
  (
    await db().pool.query(
      "SELECT testing_domain FROM test_workspace_mark WHERE workspace_id = $1",
      [workspaceId],
    )
  ).rows;

const eventsIn = async (workspaceId: string) =>
  (
    await db().pool.query<{ act: string; actor: string; subject_id: string; detail: unknown }>(
      "SELECT act, actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 ORDER BY at, id",
      [workspaceId],
    )
  ).rows;

const identityEventsAbout = async (fixture: Fixture) =>
  (
    await db().pool.query<{ act: string }>(
      `SELECT e.act FROM identity_audit_event e JOIN "user" u ON u.id = e.subject_id
        WHERE lower(u.email) LIKE $1 ORDER BY e.act`,
      [`%@${fixture.testingDomain}`],
    )
  ).rows;

const MEMBER_HELD = "SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE";
const MEMBER_SET_BACK =
  "UPDATE member SET role = 'Viewer' WHERE workspace_id = $1 AND user_id = $2";

const isWaitingOnTheRoleRead = async (): Promise<boolean> => {
  const found = await db().pool.query(
    `SELECT 1 FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT role FROM member WHERE workspace_id%'`,
  );
  return (found.rowCount ?? 0) > 0;
};

/** As the screen acts: the test Admin, holding their own member row. */
const asTheAdmin = async <T>(
  fixture: Fixture,
  workspaceId: WorkspaceId,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Result<T, unknown>>,
) => {
  const adminUserId = await personIdAt(fixture.admin);
  const workspace = {
    door: openPostgres(db().runtimePool),
    workspaceId,
    name: "Test workspace",
    slug: fixture.slug,
    adminUserId,
  };
  return heldAs(workspace, adminUserId, work);
};

describe("ensuring the test workspace", () => {
  it("makes the workspace, its mark, three people and 51 Viewers", async () => {
    const fixture = aFixture();

    const made = answeredValue(await ensured(fixture));

    expect(made).toEqual({
      workspaceId: expect.stringMatching(ULID),
      testingDomain: fixture.testingDomain,
      slug: fixture.slug,
      provisioned: true,
      mark: "written",
      peopleAdded: 54,
      membersAdded: 53,
      rolesReset: 0,
      unexpected: [],
    });
    const members = await membersOf(made.workspaceId);
    expect(members).toHaveLength(54);
    expect(members.filter((one) => one.role !== "Viewer")).toEqual([
      { address: fixture.admin, role: "Admin" },
      { address: fixture.editor, role: "Editor" },
    ]);
    expect(members.map((one) => one.address)).toContain(fixture.viewer);
    expect(members.map((one) => one.address)).toContain(inventedAt(fixture, "51"));
    expect(await markOf(made.workspaceId)).toEqual([{ testing_domain: fixture.testingDomain }]);
  });

  it("names the invented members so they sort together", async () => {
    const fixture = aFixture();
    answeredValue(await ensured(fixture));

    const invented = (await peopleOn(fixture)).filter((one) =>
      one.address.startsWith("invented-member-"),
    );

    expect(invented.map((one) => one.name)).toEqual(
      Array.from(
        { length: 51 },
        (_, index) => `Invented member ${String(index + 1).padStart(2, "0")}`,
      ),
    );
  });

  it("never grants or revokes the operator mark", async () => {
    const fixture = aFixture();

    answeredValue(await ensured(fixture));
    answeredValue(await ensured(fixture));

    expect((await peopleOn(fixture)).filter((one) => one.operator)).toEqual([]);
    expect(
      (await identityEventsAbout(fixture)).filter((one) => one.act.startsWith("people.operator.")),
    ).toEqual([]);
  });

  it("changes nothing and records nothing when run again", async () => {
    const fixture = aFixture();
    const { workspaceId } = answeredValue(await ensured(fixture));
    const events = await eventsIn(workspaceId);
    const identityEvents = await identityEventsAbout(fixture);
    const members = await membersOf(workspaceId);

    const again = await ensured(fixture);

    expect(again).toEqual({
      ok: true,
      value: {
        workspaceId,
        testingDomain: fixture.testingDomain,
        slug: fixture.slug,
        provisioned: false,
        mark: "kept",
        peopleAdded: 0,
        membersAdded: 0,
        rolesReset: 0,
        unexpected: [],
      },
    });
    expect(await eventsIn(workspaceId)).toEqual(events);
    expect(await identityEventsAbout(fixture)).toEqual(identityEvents);
    expect(await membersOf(workspaceId)).toEqual(members);
    expect(await markOf(workspaceId)).toEqual([{ testing_domain: fixture.testingDomain }]);
  });

  it("sets an invented member left as Editor back to Viewer", async () => {
    const fixture = aFixture();
    const { workspaceId } = answeredValue(await ensured(fixture));
    const invented = await personIdAt(inventedAt(fixture, "07"));
    answeredValue(
      await asTheAdmin(fixture, workspaceId, (principal, tx) =>
        changeRole(principal, tx, { personId: invented, role: "Editor" }),
      ),
    );
    const before = await eventsIn(workspaceId);

    const repaired = answeredValue(await ensured(fixture));

    expect(repaired).toMatchObject({ rolesReset: 1, membersAdded: 0, peopleAdded: 0 });
    expect((await eventsIn(workspaceId)).slice(before.length)).toEqual([
      {
        act: "people.member.role_changed",
        actor: BOOTSTRAP_ACTOR,
        subject_id: invented,
        detail: { previousRole: "Editor", role: "Viewer" },
      },
    ]);
    expect(await membersOf(workspaceId)).toContainEqual({
      address: inventedAt(fixture, "07"),
      role: "Viewer",
    });
  });

  it("restores the test Editor demoted to Viewer", async () => {
    const fixture = aFixture();
    const { workspaceId } = answeredValue(await ensured(fixture));
    const editor = await personIdAt(fixture.editor);
    answeredValue(
      await asTheAdmin(fixture, workspaceId, (principal, tx) =>
        changeRole(principal, tx, { personId: editor, role: "Viewer" }),
      ),
    );

    const repaired = answeredValue(await ensured(fixture));

    expect(repaired.rolesReset).toBe(1);
    expect(await membersOf(workspaceId)).toContainEqual({
      address: fixture.editor,
      role: "Editor",
    });
  });

  it("adds back an invented member who was removed", async () => {
    const fixture = aFixture();
    const { workspaceId } = answeredValue(await ensured(fixture));
    const invented = await personIdAt(inventedAt(fixture, "12"));
    answeredValue(
      await asTheAdmin(fixture, workspaceId, (principal, tx) =>
        removeMember(principal, tx, { personId: invented, at: new Date() }),
      ),
    );

    const repaired = answeredValue(await ensured(fixture));

    expect(repaired).toMatchObject({ membersAdded: 1, peopleAdded: 0, rolesReset: 0 });
    expect(await membersOf(workspaceId)).toContainEqual({
      address: inventedAt(fixture, "12"),
      role: "Viewer",
    });
  });

  it("records nothing for a role set back meanwhile", async () => {
    const fixture = aFixture();
    const { workspaceId } = answeredValue(await ensured(fixture));
    const invented = await personIdAt(inventedAt(fixture, "09"));
    answeredValue(
      await asTheAdmin(fixture, workspaceId, (principal, tx) =>
        changeRole(principal, tx, { personId: invented, role: "Editor" }),
      ),
    );
    const before = await eventsIn(workspaceId);
    const holder = await db().pool.connect();
    await holder.query("BEGIN");
    await holder.query(MEMBER_HELD, [workspaceId, invented]);
    const repairing = ensured(fixture);
    try {
      await until(() => isWaitingOnTheRoleRead());
      await holder.query(MEMBER_SET_BACK, [workspaceId, invented]);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }

    const repaired = answeredValue(await repairing);

    expect(repaired.rolesReset).toBe(0);
    expect(await eventsIn(workspaceId)).toEqual(before);
  });

  it("reports a member outside the fixture and leaves them", async () => {
    const fixture = aFixture();
    const { workspaceId } = answeredValue(await ensured(fixture));
    const stranger = `stranger@${fixture.testingDomain}`;
    await seedingWith(db().pool, async (seed) => {
      const person = await seed.user({ email: stranger });
      await seed.member({ workspaceId, userId: person.id, role: "Editor" });
    });

    const again = answeredValue(await ensured(fixture));

    expect(again.unexpected).toEqual([{ address: stranger, role: "Editor" }]);
    expect(await membersOf(workspaceId)).toContainEqual({ address: stranger, role: "Editor" });
  });

  it("finishes a fixture left standing without its mark", async () => {
    const fixture = aFixture();
    const halfWritten = await provisionedWorkspace(db(), "HalfWritten", { email: fixture.admin });
    const workspaceId = halfWritten.workspaceId;

    const finished = answeredValue(await ensured({ ...fixture, slug: halfWritten.slug }));

    expect(finished).toMatchObject({
      workspaceId,
      provisioned: false,
      mark: "written",
      peopleAdded: 53,
      membersAdded: 53,
    });
    expect(await markOf(workspaceId)).toEqual([{ testing_domain: fixture.testingDomain }]);
    expect(await membersOf(workspaceId)).toHaveLength(54);
    const offDomain = await asTheAdmin(fixture, workspaceId, (principal, tx) =>
      inviteMembers(principal, tx, {
        ...inputOf(inviteMembersInput, { addresses: ["ben@elsewhere.invalid"], role: "Viewer" }),
        now: new Date(),
      }),
    );
    expect(offDomain).toMatchObject({ ok: false, error: { word: "off-testing-domain" } });
  });

  it("corrects a mark naming another domain", async () => {
    const fixture = aFixture();
    const workspace = await provisionedWorkspace(db(), "Remarked", { email: fixture.admin });
    await seedingWith(db().pool, (seed) =>
      seed.testWorkspaceMark({
        workspaceId: workspace.workspaceId,
        testingDomain: "another.testing.invalid",
      }),
    );

    const remarked = answeredValue(await ensured({ ...fixture, slug: workspace.slug }));

    expect(remarked).toMatchObject({ provisioned: false, mark: "corrected" });
    expect(await markOf(workspace.workspaceId)).toEqual([
      { testing_domain: fixture.testingDomain },
    ]);
    expect(
      (await eventsIn(workspace.workspaceId)).filter(
        (one) => one.act === "platform.workspace.marked",
      ),
    ).toEqual([
      {
        act: "platform.workspace.marked",
        actor: BOOTSTRAP_ACTOR,
        subject_id: workspace.workspaceId,
        detail: { corrected: true },
      },
    ]);
  });
});

describe("what ensuring the test workspace refuses", () => {
  it("refuses an address off the testing domain, writing nothing", async () => {
    const fixture = { ...aFixture(), viewer: "viewer@elsewhere.invalid" };

    const refused = await ensured(fixture);

    expect(refused).toEqual({
      ok: false,
      error: { word: "off-testing-domain", address: "viewer@elsewhere.invalid" },
    });
    expect(await workspacesWithSlug(fixture.slug)).toEqual([]);
    expect(await peopleOn(fixture)).toEqual([]);
  });

  it("refuses a test person who is a member elsewhere", async () => {
    const fixture = aFixture();
    const elsewhere = await provisionedWorkspace(db(), "Elsewhere");
    await seedingWith(db().pool, async (seed) => {
      const person = await seed.user({ email: fixture.editor });
      await seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Viewer" });
    });

    const refused = await ensured(fixture);

    expect(refused).toEqual({
      ok: false,
      error: { word: "member-elsewhere", address: fixture.editor },
    });
    expect(await workspacesWithSlug(fixture.slug)).toEqual([]);
    expect((await peopleOn(fixture)).map((one) => one.address)).toEqual([fixture.editor]);
  });

  it("refuses an operator-marked address, whatever its memberships", async () => {
    const fixture = aFixture();
    const elsewhere = await provisionedWorkspace(db(), "OperatorElsewhere");
    await seedingWith(db().pool, async (seed) => {
      const person = await seed.user({ email: fixture.admin, operator: true });
      await seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Admin" });
    });
    await seedingWith(db().pool, (seed) => seed.user({ email: fixture.viewer, operator: true }));

    const refused = await ensured(fixture);

    expect(refused).toEqual({
      ok: false,
      error: { word: "operator-marked", address: fixture.admin },
    });
    expect(await workspacesWithSlug(fixture.slug)).toEqual([]);
    expect((await peopleOn(fixture)).map((one) => one.operator)).toEqual([true, true]);
  });

  it("refuses, never adopts, a slug held with an off-domain member", async () => {
    const fixture = aFixture();
    const held = await provisionedWorkspace(db(), "Held");
    const members = await membersOf(held.workspaceId);

    const refused = await ensured({ ...fixture, slug: held.slug });

    expect(refused).toEqual({ ok: false, error: "slug-taken" });
    expect(await membersOf(held.workspaceId)).toEqual(members);
    expect(await markOf(held.workspaceId)).toEqual([]);
    expect(await peopleOn(fixture)).toEqual([]);
  });

  it("refuses, never adopts, a slug with an off-domain invitation waiting", async () => {
    const fixture = aFixture();
    const held = await provisionedWorkspace(db(), "Inviting", { email: fixture.admin });
    await invitationsLeftIn(held, [
      { email: `ana@${fixture.testingDomain}`, status: INVITATION_WAITING_STATUS },
      { email: "ben@elsewhere.invalid", status: INVITATION_WAITING_STATUS },
    ]);
    const events = await eventsIn(held.workspaceId);

    const refused = await ensured({ ...fixture, slug: held.slug });

    expect(refused).toEqual({ ok: false, error: "slug-taken" });
    expect(await markOf(held.workspaceId)).toEqual([]);
    expect(await eventsIn(held.workspaceId)).toEqual(events);
    expect((await peopleOn(fixture)).map((one) => one.address)).toEqual([fixture.admin]);
  });

  it("adopts a slug whose off-domain invitations no longer wait", async () => {
    const fixture = aFixture();
    const held = await provisionedWorkspace(db(), "InvitedOnce", { email: fixture.admin });
    await invitationsLeftIn(held, [
      { email: "ben@elsewhere.invalid", status: INVITATION_CANCELLED_STATUS },
    ]);

    const adopted = await ensured({ ...fixture, slug: held.slug });

    expect(adopted).toMatchObject({ ok: true, value: { provisioned: false, mark: "written" } });
  });

  it("refuses one address named for two test people", async () => {
    const fixture = aFixture();

    const refused = await ensured({ ...fixture, viewer: fixture.editor });

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await peopleOn(fixture)).toEqual([]);
  });

  it("refuses a testing domain no address could carry", async () => {
    const fixture = aFixture();

    const refused = await ensured({ ...fixture, testingDomain: "journeys" });

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await workspacesWithSlug(fixture.slug)).toEqual([]);
  });

  it("refuses a testing domain the invented addresses cannot carry", async () => {
    const labels = [ulid().toLowerCase(), "a".repeat(63), "b".repeat(63), "c".repeat(63)];
    const testingDomain = [...labels, "d".repeat(13), "invalid"].join(".");
    const fixture = {
      ...aFixture(),
      testingDomain,
      admin: `admin@${testingDomain}`,
      editor: `editor@${testingDomain}`,
      viewer: `viewer@${testingDomain}`,
    };

    const refused = await ensured(fixture);

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await workspacesWithSlug(fixture.slug)).toEqual([]);
    expect(await peopleOn(fixture)).toEqual([]);
  });

  it("takes the platform's principal alone, never a person's", () => {
    expectTypeOf<Parameters<typeof ensureTestWorkspace>[0]>().toEqualTypeOf<PlatformPrincipal>();
  });
});
