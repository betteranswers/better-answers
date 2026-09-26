import type { MigratedPostgres } from "@better-answers/schema/testing";

import type { Role, UserPrincipal } from "../src/kernel/index.ts";
import {
  folded,
  type Foldable,
  type Folded,
  type Tx,
  withHeldPrincipal,
} from "../src/store/postgres/index.ts";
import type { ProvisionedWorkspace } from "./platform.ts";
import { seedingWith } from "./suite-postgres.ts";

/** As the transport holds a mutation's caller: their own member row `FOR SHARE` until commit. */
export const heldAs = async <T>(
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

/**
 * Each acts on the other once both hold their own member row, so each waits on the other's: a
 * deadlock Postgres ends by aborting one.
 */
export const bothHoldingTheirOwnRow = <T>(
  workspace: ProvisionedWorkspace,
  callers: readonly [string, string],
  act: (principal: UserPrincipal, tx: Tx, other: string) => Promise<Foldable<T>>,
): Promise<readonly [Folded<T>, Folded<T>]> => {
  const bothHold = Promise.withResolvers<undefined>();
  let holding = 0;
  const actingOn = (caller: string, other: string) =>
    heldAs(workspace, caller, async (principal, tx) => {
      holding += 1;
      if (holding === 2) bothHold.resolve(undefined);
      await bothHold.promise;
      return act(principal, tx, other);
    });
  const [first, second] = callers;
  return Promise.all([actingOn(first, second), actingOn(second, first)]);
};

/** `db` answers the suite's database once its hooks have run, so it is read at each call. */
export const membersSuite = (db: () => MigratedPostgres) => {
  /** A new person, a member of `workspace` at `role`; answers their person id. */
  const joining = (workspace: ProvisionedWorkspace, role: Role): Promise<string> =>
    seedingWith(db().pool, async (seed) => {
      const { id } = await seed.user();
      await seed.member({ workspaceId: workspace.workspaceId, userId: id, role });
      return id;
    });

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

  /** The workspace's audit rows for `act`, in the order they were written. */
  const auditRowsOf = async (workspace: ProvisionedWorkspace, act: string) => {
    const rows = await db().pool.query<{
      actor: string;
      subject_id: string;
      detail: Readonly<Record<string, string>>;
    }>(
      "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY id",
      [workspace.workspaceId, act],
    );
    return rows.rows;
  };

  return { joining, rolesOf, adminsOf, auditRowsOf };
};
