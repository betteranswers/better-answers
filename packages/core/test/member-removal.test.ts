import { describe, expect, it } from "vitest";

import type { UserPrincipal } from "../src/kernel/index.ts";
import {
  changeRole,
  changeRoleInput,
  removeMember,
  removeMemberInput,
} from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { endedGrants } from "./identity-rows.ts";
import { bothHoldingTheirOwnRow, heldAs, membersSuite } from "./members-suite.ts";
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

const { joining, rolesOf, adminsOf, auditRowsOf } = membersSuite(db);

const removalsIn = (workspace: ProvisionedWorkspace) =>
  auditRowsOf(workspace, "people.member.removed");

const removing = (principal: UserPrincipal, tx: Tx, personId: string) =>
  removeMember(principal, tx, { ...inputOf(removeMemberInput, { personId }), at: new Date() });

const removedBy = (workspace: ProvisionedWorkspace, actor: string, personId: string) =>
  heldAs(workspace, actor, (principal, tx) => removing(principal, tx, personId));

const alsoJoining = (workspace: ProvisionedWorkspace, personId: string) =>
  seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: workspace.workspaceId, userId: personId, role: "Viewer" }),
  );

const groupsHeldBy = async (workspace: ProvisionedWorkspace, personId: string) => {
  const rows = await db().pool.query<{ group_id: string }>(
    "SELECT group_id FROM group_member WHERE workspace_id = $1 AND user_id = $2",
    [workspace.workspaceId, personId],
  );
  return rows.rows.map((row) => row.group_id);
};

const aMinuteAgo = () => new Date(Date.now() - 60_000);

/** A refresh and an access token for each grant, named so an assertion reads which ended. */
const grantsTo = async (
  personId: string,
  grants: Readonly<Record<string, { readonly workspaceId: string; readonly personId?: string }>>,
) =>
  seedingWith(db().pool, async (seed) => {
    const client = await seed.oauthClient();
    const labelById = new Map<string, string>();
    for (const [grant, { workspaceId, personId: holder }] of Object.entries(grants)) {
      const held = {
        clientId: client.clientId,
        userId: holder ?? personId,
        createdAt: aMinuteAgo(),
      };
      const refresh = await seed.oauthRefreshToken({ ...held, referenceId: workspaceId });
      const access = await seed.oauthAccessToken({ ...held, referenceId: workspaceId });
      labelById.set(refresh.id, `refresh ${grant}`);
      labelById.set(access.id, `access ${grant}`);
    }
    return { clientId: client.clientId, labelById };
  });

describe("removing a member", () => {
  it("ends the membership and its groups, recording the removal", async () => {
    const workspace = await provisionedWorkspace(db(), "Removed");
    const viewer = await joining(workspace, "Viewer");
    await seedingWith(db().pool, async (seed) => {
      const group = await seed.group({ workspaceId: workspace.workspaceId, name: "HR team" });
      await seed.groupMember({
        workspaceId: workspace.workspaceId,
        groupId: group.id,
        userId: viewer,
      });
    });

    const removed = await removedBy(workspace, workspace.adminUserId, viewer);

    expect(removed).toEqual({ ok: true, value: { personId: viewer, role: "Viewer" } });
    expect(await rolesOf(workspace)).toEqual({ [workspace.adminUserId]: "Admin" });
    expect(await groupsHeldBy(workspace, viewer)).toEqual([]);
    expect(await removalsIn(workspace)).toEqual([
      {
        actor: `human:${workspace.adminUserId}`,
        subject_id: viewer,
        detail: { role: "Viewer" },
      },
    ]);
  });

  it("ends this workspace's tokens and keeps the person's other workspace", async () => {
    const here = await provisionedWorkspace(db(), "TokensHere");
    const there = await provisionedWorkspace(db(), "TokensThere");
    const person = await joining(here, "Editor");
    await alsoJoining(there, person);
    const colleague = await joining(here, "Editor");
    const issued = await grantsTo(person, {
      here: { workspaceId: here.workspaceId },
      there: { workspaceId: there.workspaceId },
      "a colleague's here": { workspaceId: here.workspaceId, personId: colleague },
    });

    await removedBy(here, here.adminUserId, person);

    expect(await endedGrants(db().pool, issued)).toEqual(["access here", "refresh here"]);
    expect((await rolesOf(there))[person]).toBe("Viewer");
  });

  it("lets one of two Admins remove themself", async () => {
    const workspace = await provisionedWorkspace(db(), "Left");
    const { adminUserId } = workspace;
    const successor = await joining(workspace, "Admin");

    const removed = await removedBy(workspace, adminUserId, adminUserId);

    expect(removed).toEqual({ ok: true, value: { personId: adminUserId, role: "Admin" } });
    expect(await adminsOf(workspace)).toEqual([successor]);
    expect(await removalsIn(workspace)).toEqual([
      { actor: `human:${adminUserId}`, subject_id: adminUserId, detail: { role: "Admin" } },
    ]);
  });
});

describe("what removing a member refuses", () => {
  it.each(["Editor", "Viewer"] as const)("refuses a member at %s, role-forbids", async (held) => {
    const workspace = await provisionedWorkspace(db(), `RemovalForbidden${held}`);
    const actor = await joining(workspace, held);
    const viewer = await joining(workspace, "Viewer");

    const refused = await removedBy(workspace, actor, viewer);

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect((await rolesOf(workspace))[viewer]).toBe("Viewer");
    expect(await removalsIn(workspace)).toEqual([]);
  });

  it("refuses a person not a member here, no-such-member", async () => {
    const ours = await provisionedWorkspace(db(), "RemovalOurs");
    const theirs = await provisionedWorkspace(db(), "RemovalTheirs");
    const elsewhere = await joining(theirs, "Viewer");
    const issued = await grantsTo(elsewhere, { theirs: { workspaceId: theirs.workspaceId } });

    const refused = await removedBy(ours, ours.adminUserId, elsewhere);

    expect(refused).toEqual({ ok: false, error: "no-such-member" });
    expect((await rolesOf(theirs))[elsewhere]).toBe("Viewer");
    expect(await endedGrants(db().pool, issued)).toEqual([]);
    expect(await removalsIn(ours)).toEqual([]);
  });

  it("leaves the membership and tokens when its audit event fails", async () => {
    const workspace = await provisionedWorkspace(db(), "RemovalUnrecorded");
    const viewer = await joining(workspace, "Viewer");
    const issued = await grantsTo(viewer, { here: { workspaceId: workspace.workspaceId } });

    const failed = await whileWritesAreRefused(db().pool, "audit_event", () =>
      removedBy(workspace, workspace.adminUserId, viewer),
    );

    expect(failed).toEqual({ ok: false, error: expect.any(Error) });
    expect((await rolesOf(workspace))[viewer]).toBe("Viewer");
    expect(await endedGrants(db().pool, issued)).toEqual([]);
  });
});

describe("the last Admin, removed", () => {
  it("refuses removing the workspace's only Admin, last-admin", async () => {
    const workspace = await provisionedWorkspace(db(), "RemovalOnlyAdmin");
    const { adminUserId } = workspace;

    const refused = await removedBy(workspace, adminUserId, adminUserId);

    expect(refused).toEqual({ ok: false, error: "last-admin" });
    expect(await adminsOf(workspace)).toEqual([adminUserId]);
    expect(await removalsIn(workspace)).toEqual([]);
  });

  it("counts the Admins an uncommitted removal leaves, not those found", async () => {
    const workspace = await provisionedWorkspace(db(), "RemovalCounted");
    const { adminUserId } = workspace;
    const other = await joining(workspace, "Admin");
    const firstActed = Promise.withResolvers<undefined>();

    /** It commits only once the second waits on it, so the second's count comes after. */
    const removingTheOther = heldAs(workspace, adminUserId, async (principal, tx) => {
      const removed = await removing(principal, tx, other);
      firstActed.resolve(undefined);
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      return removed;
    });
    await firstActed.promise;
    const removingThemself = removedBy(workspace, adminUserId, adminUserId);

    expect(await removingTheOther).toMatchObject({ ok: true });
    expect(await removingThemself).toEqual({ ok: false, error: "last-admin" });
    expect(await adminsOf(workspace)).toEqual([adminUserId]);
  });

  it("leaves one Admin when a removal and a demotion race", async () => {
    const workspace = await provisionedWorkspace(db(), "RemovalRaced");
    const first = workspace.adminUserId;
    const second = await joining(workspace, "Admin");

    const answers = await Promise.all([
      removedBy(workspace, first, second),
      heldAs(workspace, second, (principal, tx) =>
        changeRole(principal, tx, inputOf(changeRoleInput, { personId: first, role: "Editor" })),
      ),
    ]);

    expect(await adminsOf(workspace)).toHaveLength(1);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
  });

  it("answers the deadlock between two removals changed-meanwhile, never a failure", async () => {
    const workspace = await provisionedWorkspace(db(), "RemovalDeadlocked");
    const second = await joining(workspace, "Admin");

    const answers = await bothHoldingTheirOwnRow(
      workspace,
      [workspace.adminUserId, second],
      removing,
    );

    expect(answers.flatMap((answer) => (answer.ok ? [] : [answer.error]))).toEqual([
      "changed-meanwhile",
    ]);
    expect(await removalsIn(workspace)).toHaveLength(1);
    expect(await adminsOf(workspace)).toHaveLength(1);
  });
});
