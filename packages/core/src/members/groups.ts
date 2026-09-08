import { boundarySchemas, CURATED_ORIGIN } from "@better-answers/schema";
import type { z } from "zod";

import { act, declareActs, record } from "../audit/index.ts";
import { attempt, err, ok, requireAdmin, ulid } from "../kernel/index.ts";
import type {
  AdminUserPrincipal,
  GroupId,
  Result,
  RoleRefusal,
  UserId,
  UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * The group half of the **members** slice: what an Admin does to a *group*
 * (`CONTEXT.md`) — make one, rename it, delete it, put a person in or take them out, and
 * list what the workspace holds. Owns `group` and `group_member` (ADR 0038).
 *
 * **Every act takes the transaction the Principal was resolved in**, not a door. That is
 * ADR 0018's shape and not an ergonomics choice: `withPrincipal` reads the member row and
 * builds the Principal inside one transaction, so an act that opened a second one would
 * be authorised by a role read somewhere else. It is also what makes the cross-workspace
 * refusal free — the transaction's scope is the caller's own workspace, so another
 * workspace's group id resolves to no row and the act answers `no-such-group`.
 *
 * **A refusal is a row count, never a caught constraint violation.** A violation aborts
 * the caller's transaction, and an act that turned one into a word would hand back a
 * refusal the caller could act on while nothing it did could ever commit. So the unique
 * name is `ON CONFLICT … DO NOTHING`, the membership is read before the row that
 * references it, and every act's refusals are decided by what came back. A violation that
 * happens anyway — two Admins renaming to the same name in the same instant — stays the
 * store's `Error`, and the opener refuses the commit (the kernel's result convention).
 *
 * **The ledger row is written last, bare, in the same transaction**: last, because an
 * event for an act the row count refused would be a lie; bare — never inside `attempt` —
 * because the door's rejection has to abort this transaction rather than become a value
 * the act might not read. That rejection is the one thing that leaves an act here as a
 * rejection rather than a `Result`, and it is rule 5 of the kernel's result convention.
 */

type GroupRow = z.infer<typeof boundarySchemas.group.select>;

/** Where a group came from (ADR 0038), read off the boundary that narrows to the pair. */
export type GroupOrigin = GroupRow["origin"];

/** One row of the Groups screen: the group, and how many people are in it. */
export type GroupSummary = {
  readonly id: GroupId;
  readonly name: string;
  readonly origin: GroupOrigin;
  readonly memberCount: number;
};

/**
 * The slice's acts on the ledger (ADR 0038). The **group** is every act's subject, the
 * person an id in the detail, so `subject_kind` and `subject_id` index everything about
 * one group in one read. A group's name is in none of them: the detail's kinds are id,
 * role and flag, and a group named after a person would carry that person's name into a
 * table an erasure never rewrites. What the group is called now is on the row; that it
 * was renamed, and by whom, is the ledger's.
 */
const GROUP_ACTS = declareActs("people", {
  created: act("people.group.created", {}),
  renamed: act("people.group.renamed", {}),
  deleted: act("people.group.deleted", {}),
  memberAdded: act("people.group.member_added", { userId: "id" }),
  memberRemoved: act("people.group.member_removed", { userId: "id" }),
});

const GROUP_ID = boundarySchemas.group.select.shape.id;
const GROUP_NAME = boundarySchemas.group.insert.shape.name;
const GROUP_ORIGIN = boundarySchemas.group.select.shape.origin;
const PERSON_ID = boundarySchemas.user.select.shape.id;

/** What every act refuses before it reads anything: the role, and an argument of the wrong shape. */
type GuardRefusal = RoleRefusal | "malformed";
/** What an act that names a group adds: this workspace holds no group of that id. */
type TargetRefusal = GuardRefusal | "no-such-group";

export type CreateGroupInput = { readonly name: string };
export type CreateGroupRefusal = GuardRefusal | "name-taken" | Error;

export type RenameGroupInput = { readonly groupId: string; readonly name: string };
export type RenameGroupRefusal = TargetRefusal | "name-taken" | Error;

export type DeleteGroupInput = { readonly groupId: string };
export type DeleteGroupRefusal = TargetRefusal | Error;

export type GroupMemberInput = { readonly groupId: string; readonly userId: string };
export type AddToGroupRefusal = TargetRefusal | "not-a-member" | "already-in-group" | Error;
export type RemoveFromGroupRefusal = TargetRefusal | "not-in-group" | Error;

/** What an act acts on: the Admin performing it, and the group they named. */
type GroupTarget = { readonly admin: AdminUserPrincipal; readonly groupId: GroupId };

/**
 * The guard and the boundary in one step, for the four acts that name a group: an Editor
 * or a Viewer gets the one refusal word (`kernel/role.ts`) and an id of another shape gets
 * `malformed`, both before any statement runs.
 */
const groupTarget = (
  principal: UserPrincipal,
  groupId: string,
): Result<GroupTarget, TargetRefusal> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const parsed = GROUP_ID.safeParse(groupId);
  if (!parsed.success) return err("malformed");
  return ok({ admin: admin.value, groupId: parsed.data });
};

/**
 * Which word a statement that changed nothing deserves. Two acts write a statement that
 * can come back empty for either of two reasons, and only a second read tells them apart:
 * the workspace holds the group, so the act's own word applies, or it does not, and the
 * word is `no-such-group` — the same word a group id nobody holds gets, so an Admin of
 * another workspace learns nothing from asking.
 */
const nothingChanged = async <Own extends string>(
  tx: Tx,
  { admin, groupId }: GroupTarget,
  whenTheGroupIsThere: Own,
): Promise<Own | "no-such-group" | Error> => {
  const found = await attempt(() =>
    tx.query(`SELECT 1 FROM "group" WHERE workspace_id = $1 AND id = $2`, [
      admin.workspaceId,
      groupId,
    ]),
  );
  if (!found.ok) return found.error;
  return found.value.rowCount === 1 ? whenTheGroupIsThere : "no-such-group";
};

export const createGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: CreateGroupInput,
): Promise<Result<{ groupId: GroupId }, CreateGroupRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  // The whole row through the boundary at once, as provisioning does: the id is minted
  // here (nothing else may choose it), the name comes back trimmed, and the origin is the
  // Admin-curated word — nothing in this ticket mints the audience-minted kind (ADR 0038).
  const row = boundarySchemas.group.insert.safeParse({
    id: ulid(),
    workspaceId: admin.value.workspaceId,
    name: input.name,
    origin: CURATED_ORIGIN,
  });
  if (!row.success) return err("malformed");

  const made = await attempt(() =>
    tx.query<{ id: string }>(
      `INSERT INTO "group" (id, workspace_id, name, origin) VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, name) DO NOTHING
       RETURNING id`,
      [row.data.id, row.data.workspaceId, row.data.name, row.data.origin],
    ),
  );
  if (!made.ok) return err(made.error);
  // `DO NOTHING` answers no row rather than raising, so the workspace already holding the
  // name is a word the caller can act on and the transaction is still alive to hear it.
  if (made.value.rows[0] === undefined) return err("name-taken");

  await record(admin.value, tx, {
    id: ulid(),
    act: GROUP_ACTS.created,
    subjectId: row.data.id,
    detail: {},
  });
  return ok({ groupId: row.data.id });
};

export const renameGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RenameGroupInput,
): Promise<Result<{ groupId: GroupId }, RenameGroupRefusal>> => {
  const target = groupTarget(principal, input.groupId);
  if (!target.ok) return err(target.error);
  const name = GROUP_NAME.safeParse(input.name);
  if (!name.success) return err("malformed");
  const { admin, groupId } = target.value;

  const renamed = await attempt(() =>
    tx.query(
      `UPDATE "group" SET name = $3
        WHERE workspace_id = $1 AND id = $2
          AND NOT EXISTS (SELECT 1 FROM "group" other
                           WHERE other.workspace_id = $1 AND other.name = $3 AND other.id <> $2)
        RETURNING id`,
      [admin.workspaceId, groupId, name.data],
    ),
  );
  if (!renamed.ok) return err(renamed.error);
  // Nothing was renamed either because the group is not this workspace's, or because
  // another group of it already holds the name the `NOT EXISTS` looked for.
  if (renamed.value.rowCount === 0)
    return err(await nothingChanged(tx, target.value, "name-taken"));

  await record(admin, tx, {
    id: ulid(),
    act: GROUP_ACTS.renamed,
    subjectId: groupId,
    detail: {},
  });
  return ok({ groupId });
};

export const deleteGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: DeleteGroupInput,
): Promise<Result<{ groupId: GroupId }, DeleteGroupRefusal>> => {
  const target = groupTarget(principal, input.groupId);
  if (!target.ok) return err(target.error);
  const { admin, groupId } = target.value;

  // The memberships go with it, by the foreign key's cascade rather than by a second
  // statement here. Anything whose audience still names the id becomes *more* restricted,
  // never less: the read predicate is fail-closed, and the warning is a screen's (ADR 0038).
  const deleted = await attempt(() =>
    tx.query(`DELETE FROM "group" WHERE workspace_id = $1 AND id = $2 RETURNING id`, [
      admin.workspaceId,
      groupId,
    ]),
  );
  if (!deleted.ok) return err(deleted.error);
  if (deleted.value.rowCount === 0) return err("no-such-group");

  await record(admin, tx, {
    id: ulid(),
    act: GROUP_ACTS.deleted,
    subjectId: groupId,
    detail: {},
  });
  return ok({ groupId });
};

/** What the two membership acts act on: a group target, and the person named beside it. */
type MembershipTarget = GroupTarget & { readonly userId: UserId };

const membershipTarget = (
  principal: UserPrincipal,
  input: GroupMemberInput,
): Result<MembershipTarget, TargetRefusal> => {
  const target = groupTarget(principal, input.groupId);
  if (!target.ok) return err(target.error);
  const person = PERSON_ID.safeParse(input.userId);
  if (!person.success) return err("malformed");
  return ok({ ...target.value, userId: person.data });
};

export const addToGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: GroupMemberInput,
): Promise<Result<{ groupId: GroupId; userId: UserId }, AddToGroupRefusal>> => {
  const target = membershipTarget(principal, input);
  if (!target.ok) return err(target.error);
  const { admin, groupId, userId } = target.value;

  // Both preconditions in one read, because both are foreign keys on the row below and a
  // violated key would abort the caller's transaction instead of answering a word. The
  // membership is another owner's table, which the table-ownership map records.
  const known = await attempt(() =>
    tx.query<{ holds_group: boolean; is_member: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM "group" WHERE workspace_id = $1 AND id = $2) AS holds_group,
              EXISTS (SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $3) AS is_member`,
      [admin.workspaceId, groupId, userId],
    ),
  );
  if (!known.ok) return err(known.error);
  const row = known.value.rows[0];
  if (row?.holds_group !== true) return err("no-such-group");
  if (!row.is_member) return err("not-a-member");

  const added = await attempt(() =>
    tx.query(
      `INSERT INTO group_member (workspace_id, group_id, user_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
       RETURNING group_id`,
      [admin.workspaceId, groupId, userId],
    ),
  );
  if (!added.ok) return err(added.error);
  if (added.value.rowCount === 0) return err("already-in-group");

  await record(admin, tx, {
    id: ulid(),
    act: GROUP_ACTS.memberAdded,
    subjectId: groupId,
    detail: { userId },
  });
  return ok({ groupId, userId });
};

export const removeFromGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: GroupMemberInput,
): Promise<Result<{ groupId: GroupId; userId: UserId }, RemoveFromGroupRefusal>> => {
  const target = membershipTarget(principal, input);
  if (!target.ok) return err(target.error);
  const { admin, groupId, userId } = target.value;

  const removed = await attempt(() =>
    tx.query(
      "DELETE FROM group_member WHERE workspace_id = $1 AND group_id = $2 AND user_id = $3 RETURNING group_id",
      [admin.workspaceId, groupId, userId],
    ),
  );
  if (!removed.ok) return err(removed.error);
  // Nothing was removed either because the group is not this workspace's, or because the
  // person was never in it.
  if (removed.value.rowCount === 0) {
    return err(await nothingChanged(tx, target.value, "not-in-group"));
  }

  await record(admin, tx, {
    id: ulid(),
    act: GROUP_ACTS.memberRemoved,
    subjectId: groupId,
    detail: { userId },
  });
  return ok({ groupId, userId });
};

/**
 * Whether every id named is a group this workspace holds — what an act that writes an
 * audience asks before it names one (ADR 0039): a narrowing or an override naming a group
 * nobody minted would be an audience no caller could ever be in, and the act answers a
 * word for that rather than landing a row the predicate reads as *nobody*. A read of the
 * slice's own table, in the caller's transaction; the ids are the boundary's shape already,
 * or the caller would not hold a `GroupId`. Empty is vacuously true: *everyone* names none.
 */
export const holdsEveryGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  groupIds: readonly GroupId[],
): Promise<boolean> => {
  const distinct = [...new Set(groupIds)];
  if (distinct.length === 0) return true;
  const found = await tx.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM "group" WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [principal.workspaceId, distinct],
  );
  return found.rows[0]?.held === distinct.length;
};

/**
 * The workspace's groups with their member counts, by name — the Groups screen's rows.
 * A read, so it writes no ledger row; Admin-only like every other verb here, because who
 * is in which group is what an audience is written against.
 */
export const listGroups = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly GroupSummary[], RoleRefusal | Error>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);

  const listed = await attempt(async () => {
    const rows = await tx.query<{
      id: string;
      name: string;
      origin: string;
      member_count: string;
    }>(
      `SELECT g.id, g.name, g.origin, count(gm.user_id) AS member_count
         FROM "group" g
         LEFT JOIN group_member gm ON gm.workspace_id = g.workspace_id AND gm.group_id = g.id
        WHERE g.workspace_id = $1
        GROUP BY g.id, g.name, g.origin
        ORDER BY g.name`,
      [admin.value.workspaceId],
    );
    // Parsed at the boundary rather than asserted (ADR 0028), inside the attempt, so a
    // column that is not what it says comes back as the store's Error and never as a row
    // the screen would draw. `count(*)` arrives as a bigint, which pg hands over as text.
    return rows.rows.map((row) => ({
      id: GROUP_ID.parse(row.id),
      name: row.name,
      origin: GROUP_ORIGIN.parse(row.origin),
      memberCount: Number(row.member_count),
    }));
  });
  if (!listed.ok) return err(listed.error);
  return ok(listed.value);
};
