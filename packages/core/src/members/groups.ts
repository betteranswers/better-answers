import { z } from "zod";

import { boundarySchemas, CURATED_ORIGIN } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { action, declareActions, record, recordEach } from "../audit/index.ts";
import { admit, ADMIN_ALONE, attempt, declareAction, err, ok, ulid } from "../kernel/index.ts";
import type {
  AdminUserPrincipal,
  GroupId,
  RefusalOf,
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

const GROUP_ACTIONS = declareActions("people", {
  created: action("people.group.created", {}),
  renamed: action("people.group.renamed", {}),
  deleted: action("people.group.deleted", {}),
  memberAdded: action("people.group.member_added", { userId: "id" }),
  memberRemoved: action("people.group.member_removed", { userId: "id" }),
});

const GROUP_ID = boundarySchemas.group.select.shape.id;
const GROUP_NAME = boundarySchemas.group.insert.shape.name;
const GROUP_ORIGIN = boundarySchemas.group.select.shape.origin;
const PERSON_ID = boundarySchemas.user.select.shape.id;

/**
 * Each field is any text, so a name or an id the action cannot take reaches it and is refused in its
 * own word, `malformed`.
 */
export const createGroupInput = z.object({ name: z.string() });

export type CreateGroupInput = z.output<typeof createGroupInput>;

const createGroupAction = declareAction({
  admits: ADMIN_ALONE,
  input: createGroupInput,
  refuses: ["role-forbids", "malformed", "name-taken"],
});

export type CreateGroupRefusal = MemberRefusal<RefusalOf<typeof createGroupAction>> | Error;

export const renameGroupInput = z.object({ groupId: z.string(), name: z.string() });

export type RenameGroupInput = z.output<typeof renameGroupInput>;

const renameGroupAction = declareAction({
  admits: ADMIN_ALONE,
  input: renameGroupInput,
  refuses: ["role-forbids", "malformed", "no-such-group", "name-taken"],
});

export type RenameGroupRefusal = MemberRefusal<RefusalOf<typeof renameGroupAction>> | Error;

export const deleteGroupInput = z.object({ groupId: z.string() });

export type DeleteGroupInput = z.output<typeof deleteGroupInput>;

const deleteGroupAction = declareAction({
  admits: ADMIN_ALONE,
  input: deleteGroupInput,
  refuses: ["role-forbids", "malformed", "no-such-group"],
});

export type DeleteGroupRefusal = MemberRefusal<RefusalOf<typeof deleteGroupAction>> | Error;

export const groupMemberInput = z.object({ groupId: z.string(), userId: z.string() });

export type GroupMemberInput = z.output<typeof groupMemberInput>;

const addToGroupAction = declareAction({
  admits: ADMIN_ALONE,
  input: groupMemberInput,
  refuses: ["role-forbids", "malformed", "no-such-group", "no-such-member", "already-in-group"],
});

export type AddToGroupRefusal = MemberRefusal<RefusalOf<typeof addToGroupAction>> | Error;

const removeFromGroupAction = declareAction({
  admits: ADMIN_ALONE,
  input: groupMemberInput,
  refuses: ["role-forbids", "malformed", "no-such-group", "not-in-group"],
});

export type RemoveFromGroupRefusal = MemberRefusal<RefusalOf<typeof removeFromGroupAction>> | Error;

type GroupTarget = { readonly admin: AdminUserPrincipal; readonly groupId: GroupId };

const groupTarget = (
  admin: AdminUserPrincipal,
  groupId: string,
): Result<GroupTarget, MemberRefusal<"malformed">> => {
  const parsed = GROUP_ID.safeParse(groupId);
  if (!parsed.success) return err("malformed");
  return ok({ admin, groupId: parsed.data });
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
  const admin = admit(createGroupAction, principal, input);
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
    action: GROUP_ACTIONS.created,
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
  const admitted = admit(renameGroupAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const target = groupTarget(admitted.value, input.groupId);
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
    action: GROUP_ACTIONS.renamed,
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
  const admitted = admit(deleteGroupAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const target = groupTarget(admitted.value, input.groupId);
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
    action: GROUP_ACTIONS.deleted,
    subjectId: groupId,
    detail: {},
  });
  return ok({ groupId });
};

type MemberTarget = GroupTarget & { readonly userId: UserId };

const memberTarget = (
  admin: AdminUserPrincipal,
  input: GroupMemberInput,
): Result<MemberTarget, MemberRefusal<"malformed">> => {
  const target = groupTarget(admin, input.groupId);
  if (!target.ok) return err(target.error);
  const person = PERSON_ID.safeParse(input.userId);
  if (!person.success) return err("malformed");
  return ok({ ...target.value, userId: person.data });
};

/**
 * A step on rows its action holds: each person into the group, in person id order, so two such steps
 * over one group never wait on each other in a cycle. Answers those the insert landed, in that
 * order, one audit event each; one already in lands nothing.
 */
export const addedToGroup = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  asked: { readonly groupId: GroupId; readonly personIds: readonly UserId[] },
): Promise<readonly UserId[]> => {
  const landed = await tx.query<{ user_id: string }>(
    `INSERT INTO group_member (workspace_id, group_id, user_id)
       SELECT $1, $2, asked.user_id FROM unnest($3::text[]) AS asked(user_id) ORDER BY asked.user_id
         ON CONFLICT DO NOTHING
     RETURNING user_id`,
    [admin.workspaceId, asked.groupId, asked.personIds],
  );
  // RETURNING promises no order, so the answer and its events are put in it here.
  const added = landed.rows.map((row) => PERSON_ID.parse(row.user_id)).toSorted(byCodeUnit);
  await recordEach(
    admin,
    tx,
    GROUP_ACTIONS.memberAdded,
    added.map((userId) => ({ subjectId: asked.groupId, detail: { userId } })),
  );
  return added;
};

const groupAndMemberStand = async (
  tx: Tx,
  { admin, groupId, userId }: MemberTarget,
): Promise<Result<undefined, MemberRefusal<"no-such-group" | "no-such-member"> | Error>> => {
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
  return ok(undefined);
};

export const addToGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: GroupMemberInput,
): Promise<Result<{ groupId: GroupId; userId: UserId }, AddToGroupRefusal>> => {
  const admitted = admit(addToGroupAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const target = memberTarget(admitted.value, input);
  if (!target.ok) return err(target.error);
  const { admin, groupId, userId } = target.value;

  const standing = await groupAndMemberStand(tx, target.value);
  if (!standing.ok) return err(standing.error);

  const added = await attempt(() => addedToGroup(admin, tx, { groupId, personIds: [userId] }));
  if (!added.ok) return err(added.error);
  if (added.value.length === 0) return err("already-in-group");
  return ok({ groupId, userId });
};

export const removeFromGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: GroupMemberInput,
): Promise<Result<{ groupId: GroupId; userId: UserId }, RemoveFromGroupRefusal>> => {
  const admitted = admit(removeFromGroupAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const target = memberTarget(admitted.value, input);
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
    action: GROUP_ACTIONS.memberRemoved,
    subjectId: groupId,
    detail: { userId },
  });
  return ok({ groupId, userId });
};

const holdsEveryGroupAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.custom<readonly GroupId[]>(),
  refuses: ["role-forbids"],
});

/**
 * True for an empty list, and a repeated id counts once. A failed query rejects rather than
 * answering an error.
 */
export const holdsEveryGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  groupIds: readonly GroupId[],
): Promise<Result<boolean, MemberRefusal<RefusalOf<typeof holdsEveryGroupAction>>>> => {
  const admin = admit(holdsEveryGroupAction, principal, groupIds);
  if (!admin.ok) return err(admin.error);
  const distinct = [...new Set(groupIds)];
  if (distinct.length === 0) return ok(true);
  const found = await tx.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM "group" WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [admin.value.workspaceId, distinct],
  );
  return ok(found.rows[0]?.held === distinct.length);
};

const listGroupsAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

/** In name order. */
export const listGroups = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<
  Result<readonly GroupSummary[], MemberRefusal<RefusalOf<typeof listGroupsAction>> | Error>
> => {
  const admin = admit(listGroupsAction, principal, {});
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
