import { describe, expect, it } from "vitest";

import type { Role, UserPrincipal } from "../src/kernel/index.ts";
import { flagDisplayName, flagDisplayNameInput } from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { correctionOf } from "./identity-rows.ts";
import { heldAs, membersSuite } from "./members-suite.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import {
  countWaitingOnLocks,
  postgresForSuite,
  seedingWith,
  until,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const db = postgresForSuite();

const NAME_FLAGGED = "people.person.name_flagged";

const FLAG_RAISED = "people.name_flag.raised";

const RUDE_NAME = "Rude Name";

const aPerson = (name = RUDE_NAME): Promise<string> =>
  seedingWith(db().pool, async (seed) => (await seed.user({ name })).id);

const joined = async (workspace: ProvisionedWorkspace, personId: string, role: Role) => {
  await seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: workspace.workspaceId, userId: personId, role }),
  );
  return personId;
};

const flagging = (principal: UserPrincipal, tx: Tx, personId: string) =>
  flagDisplayName(principal, tx, inputOf(flagDisplayNameInput, { personId }));

const flaggedBy = (workspace: ProvisionedWorkspace, actor: string, personId: string) =>
  heldAs(workspace, actor, (principal, tx) => flagging(principal, tx, personId));

const { auditRowsOf } = membersSuite(db);

const flaggedIn = (workspace: ProvisionedWorkspace) => auditRowsOf(workspace, NAME_FLAGGED);

const raisedFor = async (personId: string) =>
  (
    await db().pool.query<{
      actor: string;
      subject_kind: string;
      subject_id: string;
      detail: object;
    }>(
      `SELECT actor, subject_kind, subject_id, detail FROM identity_audit_event
        WHERE subject_id = $1 AND act = $2 ORDER BY at, id`,
      [personId, FLAG_RAISED],
    )
  ).rows;

/** How many rows the flag left on each audit log. */
const flagsOn = async (workspace: ProvisionedWorkspace, personId: string) => ({
  flagged: (await flaggedIn(workspace)).length,
  raised: (await raisedFor(personId)).length,
});

const alreadyWaited = (personId: string) => ({ ok: true, value: { personId, raised: null } });

const nameOf = async (personId: string): Promise<string | undefined> =>
  (await db().pool.query<{ name: string }>('SELECT name FROM "user" WHERE id = $1', [personId]))
    .rows[0]?.name;

const correctedSince = async (personId: string) => {
  const operatorId = await seedingWith(
    db().pool,
    async (seed) => (await seed.user({ operator: true })).id,
  );
  await correctionOf(db().pool, { personId, operatorId });
};

describe("flagging a member's display name", () => {
  it("raises one flag on both audit logs, holding no name", async () => {
    const workspace = await provisionedWorkspace(db(), "Flagged");
    const person = await joined(workspace, await aPerson(), "Viewer");

    const flagged = await flaggedBy(workspace, workspace.adminUserId, person);

    expect(flagged).toEqual({
      ok: true,
      value: {
        personId: person,
        raised: {
          workspaceId: workspace.workspaceId,
          workspaceName: "Flagged",
          personId: person,
          displayName: RUDE_NAME,
        },
      },
    });
    expect(await flaggedIn(workspace)).toEqual([
      { actor: `human:${workspace.adminUserId}`, subject_id: person, detail: {} },
    ]);
    expect(await raisedFor(person)).toEqual([
      {
        actor: `human:${workspace.adminUserId}`,
        subject_kind: "name_flag",
        subject_id: person,
        detail: { workspaceId: workspace.workspaceId },
      },
    ]);
    expect(JSON.stringify([await flaggedIn(workspace), await raisedFor(person)])).not.toContain(
      "Rude",
    );
  });

  it("leaves the display name as the person gave it", async () => {
    const workspace = await provisionedWorkspace(db(), "Unrenamed");
    const person = await joined(workspace, await aPerson(), "Editor");

    await flaggedBy(workspace, workspace.adminUserId, person);

    expect(await nameOf(person)).toBe(RUDE_NAME);
  });

  it("lets an Admin flag their own display name", async () => {
    const workspace = await provisionedWorkspace(db(), "Themself");

    const flagged = await flaggedBy(workspace, workspace.adminUserId, workspace.adminUserId);

    expect(flagged).toMatchObject({ ok: true, value: { raised: { workspaceName: "Themself" } } });
    expect(await raisedFor(workspace.adminUserId)).toHaveLength(1);
  });
});

describe("a flag that already waits", () => {
  it("answers a second flag the same, writing nothing new", async () => {
    const workspace = await provisionedWorkspace(db(), "Twice");
    const person = await joined(workspace, await aPerson(), "Viewer");
    await flaggedBy(workspace, workspace.adminUserId, person);

    const again = await flaggedBy(workspace, workspace.adminUserId, person);

    expect(again).toEqual(alreadyWaited(person));
    expect(await flagsOn(workspace, person)).toEqual({ flagged: 1, raised: 1 });
  });

  it("waits per workspace: another workspace's flag raises its own", async () => {
    const ours = await provisionedWorkspace(db(), "OursFirst");
    const theirs = await provisionedWorkspace(db(), "TheirsNext");
    const person = await aPerson();
    await joined(ours, person, "Viewer");
    await joined(theirs, person, "Editor");
    await flaggedBy(ours, ours.adminUserId, person);

    const theirFlag = await flaggedBy(theirs, theirs.adminUserId, person);

    expect(theirFlag).toMatchObject({
      ok: true,
      value: { raised: { workspaceName: "TheirsNext" } },
    });
    expect((await raisedFor(person)).map((row) => row.detail)).toEqual([
      { workspaceId: ours.workspaceId },
      { workspaceId: theirs.workspaceId },
    ]);
  });

  it("a correction ends the wait; the next flag raises again", async () => {
    const workspace = await provisionedWorkspace(db(), "Corrected");
    const person = await joined(workspace, await aPerson(), "Viewer");
    await flaggedBy(workspace, workspace.adminUserId, person);
    await correctedSince(person);

    const afterTheCorrection = await flaggedBy(workspace, workspace.adminUserId, person);

    expect(afterTheCorrection).toMatchObject({ ok: true, value: { raised: { personId: person } } });
    expect(await flagsOn(workspace, person)).toEqual({ flagged: 2, raised: 2 });
  });

  it("raises one flag from two by two Admins at once", async () => {
    const workspace = await provisionedWorkspace(db(), "AtOnce");
    const second = await joined(workspace, await aPerson("Second Admin"), "Admin");
    const person = await joined(workspace, await aPerson(), "Viewer");
    const firstRaised = Promise.withResolvers<undefined>();

    /** It commits only once the second waits on it, so the second reads after the first's write. */
    const first = heldAs(workspace, workspace.adminUserId, async (principal, tx) => {
      const flagged = await flagging(principal, tx, person);
      firstRaised.resolve(undefined);
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      return flagged;
    });
    await firstRaised.promise;
    const secondAnswer = await flaggedBy(workspace, second, person);

    expect(await first).toMatchObject({ ok: true, value: { raised: { personId: person } } });
    expect(secondAnswer).toEqual(alreadyWaited(person));
    expect(await flagsOn(workspace, person)).toEqual({ flagged: 1, raised: 1 });
  });
});

describe("what flagging a display name refuses", () => {
  it.each(["Editor", "Viewer"] as const)("refuses a member at %s, role-forbids", async (role) => {
    const workspace = await provisionedWorkspace(db(), `Flagger${role}`);
    const actor = await joined(workspace, await aPerson("Not An Admin"), role);
    const person = await joined(workspace, await aPerson(), "Viewer");

    const refused = await flaggedBy(workspace, actor, person);

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await flaggedIn(workspace)).toEqual([]);
    expect(await raisedFor(person)).toEqual([]);
  });

  it("refuses a person not a member here, no-such-member", async () => {
    const ours = await provisionedWorkspace(db(), "NotOurs");
    const theirs = await provisionedWorkspace(db(), "Theirs");
    const elsewhere = await joined(theirs, await aPerson(), "Viewer");

    const refused = await flaggedBy(ours, ours.adminUserId, elsewhere);

    expect(refused).toEqual({ ok: false, error: "no-such-member" });
    expect(await flaggedIn(ours)).toEqual([]);
    expect(await raisedFor(elsewhere)).toEqual([]);
  });

  it("writes neither flag when the identity set's write fails", async () => {
    const workspace = await provisionedWorkspace(db(), "Unraised");
    const person = await joined(workspace, await aPerson(), "Viewer");

    const failed = await whileWritesAreRefused(db().pool, "identity_audit_event", () =>
      flaggedBy(workspace, workspace.adminUserId, person),
    );

    expect(failed).toEqual({ ok: false, error: expect.any(Error) });
    expect(await flaggedIn(workspace)).toEqual([]);
    expect(await raisedFor(person)).toEqual([]);
  });
});
