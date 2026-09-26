import { z } from "zod";

import { boundarySchemas, CURATED_ORIGIN } from "@better-answers/schema";

import { act, declareActs, record } from "../audit/index.ts";
import { attempt, err, ok, requireAdmin, ulid } from "../kernel/index.ts";
import type {
  AdminUserPrincipal,
  GroupId,
  Result,
  UserId,
  UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

type GroupRow = z.infer<typeof boundarySchemas.group.select>;

type GroupOrigin = GroupRow["origin"];

export type GroupSummary = {
  readonly id: GroupId;
  readonly name: string;
  readonly origin: GroupOrigin;
  readonly memberCount: number;
};

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

type AdminRefusal = MemberRefusal<"role-forbids">;

type GuardRefusal = AdminRefusal | MemberRefusal<"malformed">;

type TargetRefusal = GuardRefusal | MemberRefusal<"no-such-group">;

/**
 * Each field is any text, so a name or an id the act cannot take reaches it and is refused in its
 * own word, `malformed`.
 */
export const createGroupInput = z.object({ name: z.string() });

export type CreateGroupInput = z.output<typeof createGroupInput>;
export type CreateGroupRefusal = GuardRefusal | MemberRefusal<"name-taken"> | Error;

export const renameGroupInput = z.object({ groupId: z.string(), name: z.string() });

export type RenameGroupInput = z.output<typeof renameGroupInput>;
export type RenameGroupRefusal = TargetRefusal | MemberRefusal<"name-taken"> | Error;

export const deleteGroupInput = z.object({ groupId: z.string() });

export type DeleteGroupInput = z.output<typeof deleteGroupInput>;
export type DeleteGroupRefusal = TargetRefusal | Error;

export const groupMemberInput = z.object({ groupId: z.string(), userId: z.string() });

export type GroupMemberInput = z.output<typeof groupMemberInput>;
export type AddToGroupRefusal =
  | TargetRefusal
  | MemberRefusal<"no-such-member" | "already-in-group">
  | Error;
export type RemoveFromGroupRefusal = TargetRefusal | MemberRefusal<"not-in-group"> | Error;

type GroupTarget = { readonly admin: AdminUserPrincipal; readonly groupId: GroupId };

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
  if (!row.is_member) return err("no-such-member");

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
 * True for an empty list, and a repeated id counts once. A failed query rejects rather than
 * answering an error.
 */
export const holdsEveryGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  groupIds: readonly GroupId[],
): Promise<Result<boolean, AdminRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const distinct = [...new Set(groupIds)];
  if (distinct.length === 0) return ok(true);
  const found = await tx.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM "group" WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [admin.value.workspaceId, distinct],
  );
  return ok(found.rows[0]?.held === distinct.length);
};

/** In name order. */
export const listGroups = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly GroupSummary[], AdminRefusal | Error>> => {
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
