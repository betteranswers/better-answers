import { describe, expect, it } from "vitest";

import type { Role, UserPrincipal } from "../src/kernel/index.ts";
import { changeRole, changeRoleInput, listMembers } from "../src/members/index.ts";
import {
  folded,
  type Foldable,
  type Folded,
  type Tx,
  withHeldPrincipal,
} from "../src/store/postgres/index.ts";
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

const ROLE_CHANGED = "people.member.role_changed";

const joining = (workspace: ProvisionedWorkspace, role: Role): Promise<string> =>
  seedingWith(db().pool, async (seed) => {
    const { id } = await seed.user();
    await seed.member({ workspaceId: workspace.workspaceId, userId: id, role });
    return id;
  });

/** As the transport holds a mutation's caller: their own member row `FOR SHARE` until commit. */
const heldAs = async <T>(
  workspace: ProvisionedWorkspace,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T>> =>
  folded<T>(
    await withHeldPrincipal(
      workspace.door,
      { workspaceId: workspace.workspaceId, userId, issuedAt: new Date() },
      work,
    ),
  );

const changing = (principal: UserPrincipal, tx: Tx, personId: string, role: string) =>
  changeRole(principal, tx, inputOf(changeRoleInput, { personId, role }));

const roleChangedBy = (
  workspace: ProvisionedWorkspace,
  actor: string,
  personId: string,
  role: string,
) => heldAs(workspace, actor, (principal, tx) => changing(principal, tx, personId, role));

const rolesOf = async (
  workspace: ProvisionedWorkspace,
): Promise<Readonly<Record<string, string>>> => {
  const held = await db().pool.query<{ user_id: string; role: string }>(
    "SELECT user_id, role FROM member WHERE workspace_id = $1",
    [workspace.workspaceId],
  );
  return Object.fromEntries(held.rows.map((row) => [row.user_id, row.role]));
};

const adminsOf = async (workspace: ProvisionedWorkspace): Promise<readonly string[]> =>
  Object.entries(await rolesOf(workspace))
    .filter(([, role]) => role === "Admin")
    .map(([userId]) => userId);

const roleChangesIn = async (workspace: ProvisionedWorkspace) => {
  const rows = await db().pool.query<{
    actor: string;
    subject_id: string;
    detail: Readonly<Record<string, string>>;
  }>(
    "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY id",
    [workspace.workspaceId, ROLE_CHANGED],
  );
  return rows.rows;
};

describe("changing a member's role", () => {
  it("moves a member to the asked role, recording both roles", async () => {
    const workspace = await provisionedWorkspace(db(), "Rolled");
    const viewer = await joining(workspace, "Viewer");

    const changed = await roleChangedBy(workspace, workspace.adminUserId, viewer, "Editor");

    expect(changed).toEqual({
      ok: true,
      value: { personId: viewer, previousRole: "Viewer", role: "Editor" },
    });
    expect((await rolesOf(workspace))[viewer]).toBe("Editor");
    expect(await roleChangesIn(workspace)).toEqual([
      {
        actor: `human:${workspace.adminUserId}`,
        subject_id: viewer,
        detail: { previousRole: "Viewer", role: "Editor" },
      },
    ]);
  });

  it("applies on the member's next request", async () => {
    const workspace = await provisionedWorkspace(db(), "NextRequest");
    const second = await joining(workspace, "Admin");

    const before = await heldAs(workspace, second, listMembers);
    await roleChangedBy(workspace, workspace.adminUserId, second, "Viewer");
    const after = await heldAs(workspace, second, listMembers);

    expect(before.ok).toBe(true);
    expect(after).toEqual({ ok: false, error: "role-forbids" });
  });

  it("promotes a member to Admin", async () => {
    const workspace = await provisionedWorkspace(db(), "Promoted");
    const editor = await joining(workspace, "Editor");

    await roleChangedBy(workspace, workspace.adminUserId, editor, "Admin");

    expect([...(await adminsOf(workspace))].sort()).toEqual([workspace.adminUserId, editor].sort());
  });

  it("writes nothing when the member already holds the role asked", async () => {
    const workspace = await provisionedWorkspace(db(), "Unmoved");
    const editor = await joining(workspace, "Editor");

    const changed = await roleChangedBy(workspace, workspace.adminUserId, editor, "Editor");

    expect(changed).toEqual({
      ok: true,
      value: { personId: editor, previousRole: "Editor", role: "Editor" },
    });
    expect(await roleChangesIn(workspace)).toEqual([]);
  });
});

describe("what changing a role refuses", () => {
  it.each(["Owner", "admin", ""])("refuses %j, no-such-role, and writes nothing", async (role) => {
    const workspace = await provisionedWorkspace(db(), "NoSuchRole");
    const viewer = await joining(workspace, "Viewer");

    const refused = await roleChangedBy(workspace, workspace.adminUserId, viewer, role);

    expect(refused).toEqual({ ok: false, error: "no-such-role" });
    expect((await rolesOf(workspace))[viewer]).toBe("Viewer");
    expect(await roleChangesIn(workspace)).toEqual([]);
  });

  it.each(["Editor", "Viewer"] as const)("refuses a member at %s, role-forbids", async (held) => {
    const workspace = await provisionedWorkspace(db(), `Forbidden${held}`);
    const actor = await joining(workspace, held);
    const viewer = await joining(workspace, "Viewer");

    const refused = await roleChangedBy(workspace, actor, viewer, "Editor");

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect((await rolesOf(workspace))[viewer]).toBe("Viewer");
  });

  it("refuses a person not a member here, no-such-member", async () => {
    const ours = await provisionedWorkspace(db(), "OursOnly");
    const theirs = await provisionedWorkspace(db(), "TheirsOnly");
    const elsewhere = await joining(theirs, "Viewer");

    const refused = await roleChangedBy(ours, ours.adminUserId, elsewhere, "Editor");

    expect(refused).toEqual({ ok: false, error: "no-such-member" });
    expect((await rolesOf(theirs))[elsewhere]).toBe("Viewer");
    expect(await roleChangesIn(theirs)).toEqual([]);
  });

  it("leaves the role unchanged when its audit event fails", async () => {
    const workspace = await provisionedWorkspace(db(), "Unrecorded");
    const viewer = await joining(workspace, "Viewer");

    const failed = await whileWritesAreRefused(db().pool, "audit_event", () =>
      roleChangedBy(workspace, workspace.adminUserId, viewer, "Editor"),
    );

    expect(failed).toEqual({ ok: false, error: expect.any(Error) });
    expect((await rolesOf(workspace))[viewer]).toBe("Viewer");
  });
});

describe("the last Admin", () => {
  it("refuses demoting the workspace's only Admin, last-admin, and writes nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "OnlyAdmin");
    const { adminUserId } = workspace;

    const refused = await roleChangedBy(workspace, adminUserId, adminUserId, "Editor");

    expect(refused).toEqual({ ok: false, error: "last-admin" });
    expect(await adminsOf(workspace)).toEqual([adminUserId]);
    expect(await roleChangesIn(workspace)).toEqual([]);
  });

  it("lets one of two Admins demote themself", async () => {
    const workspace = await provisionedWorkspace(db(), "HandedOver");
    const { adminUserId } = workspace;
    const successor = await joining(workspace, "Admin");

    const changed = await roleChangedBy(workspace, adminUserId, adminUserId, "Viewer");

    expect(changed).toEqual({
      ok: true,
      value: { personId: adminUserId, previousRole: "Admin", role: "Viewer" },
    });
    expect(await adminsOf(workspace)).toEqual([successor]);
  });

  it("counts the Admins an uncommitted demotion leaves, not those found", async () => {
    const workspace = await provisionedWorkspace(db(), "Counted");
    const { adminUserId } = workspace;
    const other = await joining(workspace, "Admin");
    const firstActed = Promise.withResolvers<undefined>();

    /** It commits only once the second waits on it, so the second's count comes after. */
    const demotingTheOther = heldAs(workspace, adminUserId, async (principal, tx) => {
      const changed = await changing(principal, tx, other, "Viewer");
      firstActed.resolve(undefined);
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      return changed;
    });
    await firstActed.promise;
    const demotingThemself = roleChangedBy(workspace, adminUserId, adminUserId, "Viewer");

    expect(await demotingTheOther).toMatchObject({ ok: true });
    expect(await demotingThemself).toEqual({ ok: false, error: "last-admin" });
    expect(await adminsOf(workspace)).toEqual([adminUserId]);
  });

  it("leaves one Admin when two Admins demote each other", async () => {
    const workspace = await provisionedWorkspace(db(), "Raced");
    const first = workspace.adminUserId;
    const second = await joining(workspace, "Admin");

    const answers = await Promise.all([
      roleChangedBy(workspace, first, second, "Editor"),
      roleChangedBy(workspace, second, first, "Editor"),
    ]);

    expect(await adminsOf(workspace)).toHaveLength(1);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.flatMap((answer) => (answer.ok ? [] : [answer.error]))).toEqual([
      expect.any(String),
    ]);
    expect(await roleChangesIn(workspace)).toHaveLength(1);
  });

  it("answers the deadlock between two demotions changed-meanwhile, never a failure", async () => {
    const workspace = await provisionedWorkspace(db(), "Deadlocked");
    const first = workspace.adminUserId;
    const second = await joining(workspace, "Admin");
    const bothHold = Promise.withResolvers<undefined>();
    let holding = 0;

    /** Each waits until both hold their own member row, so each then waits on the other's. */
    const demotingOnceBothHold = (actor: string, target: string) =>
      heldAs(workspace, actor, async (principal, tx) => {
        holding += 1;
        if (holding === 2) bothHold.resolve(undefined);
        await bothHold.promise;
        return changing(principal, tx, target, "Editor");
      });

    const answers = await Promise.all([
      demotingOnceBothHold(first, second),
      demotingOnceBothHold(second, first),
    ]);

    expect(answers.map((answer) => answer.ok).sort()).toEqual([false, true]);
    expect(answers.find((answer) => !answer.ok)).toEqual({
      ok: false,
      error: "changed-meanwhile",
    });
    expect(await adminsOf(workspace)).toHaveLength(1);
    expect(await roleChangesIn(workspace)).toHaveLength(1);
  });
});
