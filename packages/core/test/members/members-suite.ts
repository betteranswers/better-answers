import type { Role, UserPrincipal } from "@better-answers/core/kernel";
import {
  folded,
  type Foldable,
  type Folded,
  type Tx,
  withHeldPrincipal,
} from "@better-answers/core/store/postgres";
import type { MigratedPostgres } from "@better-answers/schema/testing";

import { confirmedSessionFor, endedGrants, type NamedGrants } from "../support/identity-rows.ts";
import type { ProvisionedWorkspace } from "../support/platform.ts";
import { seedingWith } from "../support/suite-postgres.ts";

export const heldAs = async <T>(
  workspace: ProvisionedWorkspace,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
  confirmedAt: Date = new Date(),
): Promise<Folded<T>> => {
  const sessionId = await confirmedSessionFor(workspace.door.pool, userId, confirmedAt);
  return folded<T>(
    await withHeldPrincipal(
      workspace.door,
      {
        workspaceId: workspace.workspaceId,
        userId,
        issuedAt: confirmedAt,
        sessionId,
      },
      work,
    ),
  );
};

/**
 * Each caller locks its own member row and then acts on the other's, so Postgres detects a
 * deadlock and aborts one.
 */
export const actingOnEachOther = <T>(
  workspace: ProvisionedWorkspace,
  callers: readonly [string, string],
  action: (principal: UserPrincipal, tx: Tx, other: string) => Promise<Foldable<T>>,
  confirmedAt: Date = new Date(),
): Promise<readonly [Folded<T>, Folded<T>]> => {
  const bothHold = Promise.withResolvers<undefined>();
  let holding = 0;
  const actingOn = (caller: string, other: string) =>
    heldAs(
      workspace,
      caller,
      async (principal, tx) => {
        holding += 1;
        if (holding === 2) bothHold.resolve(undefined);
        await bothHold.promise;
        return action(principal, tx, other);
      },
      confirmedAt,
    );
  const [first, second] = callers;
  return Promise.all([actingOn(first, second), actingOn(second, first)]);
};

/** `db` returns the suite's database only after its hooks run, so call it inside each helper. */
export const membersSuite = (db: () => MigratedPostgres) => {
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

  const auditRowsOf = async (workspace: ProvisionedWorkspace, action: string) => {
    const rows = await db().pool.query<{
      actor: string;
      subject_id: string;
      detail: Readonly<Record<string, unknown>>;
    }>(
      "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND action = $2 ORDER BY id",
      [workspace.workspaceId, action],
    );
    return rows.rows;
  };

  const batchesOf = async (workspace: ProvisionedWorkspace, action: string) => {
    const rows = await db().pool.query<{ batch_id: string | null }>(
      "SELECT batch_id FROM audit_event WHERE workspace_id = $1 AND action = $2 ORDER BY id",
      [workspace.workspaceId, action],
    );
    return rows.rows.map((row) => row.batch_id);
  };

  const grantsEndedAbout = async (personId: string) => {
    const rows = await db().pool.query<{
      actor: string;
      detail: Readonly<Record<string, unknown>>;
    }>(
      `SELECT actor, detail FROM identity_audit_event
        WHERE subject_id = $1 AND action = 'people.person.grants_ended' ORDER BY id`,
      [personId],
    );
    return rows.rows;
  };

  const grantsHere = (workspace: ProvisionedWorkspace, holders: Readonly<Record<string, string>>) =>
    seedingWith(db().pool, async (seed) => {
      const { clientId } = await seed.oauthClient();
      const issuedAt = new Date(Date.now() - 60_000);
      const labelById = new Map<string, string>();
      for (const [holder, userId] of Object.entries(holders)) {
        const held = { clientId, userId, referenceId: workspace.workspaceId, createdAt: issuedAt };
        labelById.set((await seed.oauthRefreshToken(held)).id, `refresh ${holder}`);
        labelById.set((await seed.oauthAccessToken(held)).id, `access ${holder}`);
      }
      return { clientId, labelById, issuedAt };
    });

  const endedOf = (grants: NamedGrants) => endedGrants(db().pool, grants);

  return {
    joining,
    rolesOf,
    adminsOf,
    auditRowsOf,
    batchesOf,
    grantsEndedAbout,
    grantsHere,
    endedOf,
  };
};
