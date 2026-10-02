import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { batchIdFor } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type AdminUserPrincipal,
  type GroupId,
  type RefusedItems,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import { refusalOfDeadlock, type Tx } from "../store/postgres/index.ts";
import { addedToGroup } from "./groups.ts";
import { lastAdminsAmong, withMembersHeld } from "./last-admin.ts";
import { memberRemovedHere } from "./removal.ts";
import { roleWritten } from "./roles.ts";
import {
  distinct,
  namedEach,
  notAmong,
  outcomeOf,
  refusedItemsOf,
  type BulkOutcome,
} from "./sets.ts";
import type { MemberRefusal } from "./vocabulary.ts";

export type { BulkOutcome } from "./sets.ts";

/** One act holds at most this many member rows until it commits. */
const MOST_TICKED = 200;

const PERSON_ID = boundarySchemas.user.select.shape.id;

const TICKED = z.array(PERSON_ID).min(1).max(MOST_TICKED);

const ROLE = boundarySchemas.member.select.shape.role;

/** The role is any text, so a role outside the three reaches the act and is refused in its word. */
export const bulkChangeRoleInput = z.object({ personIds: TICKED, role: z.string() });

export type BulkChangeRoleInput = z.output<typeof bulkChangeRoleInput>;

const bulkChangeRoleAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: bulkChangeRoleInput,
  refuses: ["role-forbids", "no-such-role", "no-such-member", "last-admin", "changed-meanwhile"],
  effect: "write",
});

export type BulkChangeRoleRefusal =
  | MemberRefusal<"role-forbids" | "no-such-role" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"no-such-member" | "last-admin">>
  | Error;

/**
 * Moves every ticked member to the role, or no one: an id no member here holds, or a change that
 * would leave no Admin, refuses the set naming each such person. A member already at the role is
 * skipped.
 */
export const bulkChangeRole = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BulkChangeRoleInput,
): Promise<Result<BulkOutcome, BulkChangeRoleRefusal>> => {
  const admitted = admit(bulkChangeRoleAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const role = ROLE.safeParse(input.role);
  if (!role.success) return err("no-such-role");
  const admin = admitted.value;
  const personIds = distinct(input.personIds);

  return withMembersHeld(admin, tx, personIds, async (held) => {
    const moving = held.rows.filter((row) => row.role !== role.data);
    const refused = refusedItemsOf([
      ...namedEach(
        notAmong(
          personIds,
          held.rows.map((row) => row.personId),
        ),
        "no-such-member",
      ),
      ...namedEach(lastAdminsAmong(held, moving), "last-admin"),
    ]);
    if (refused !== undefined) return err(refused);

    const batchId = batchIdFor(moving.length);
    for (const { personId, role: previousRole } of moving) {
      await roleWritten(admin, tx, { personId, previousRole, role: role.data }, batchId);
    }
    return ok(
      outcomeOf(
        personIds,
        moving.map((row) => row.personId),
      ),
    );
  });
};

export const bulkRemoveMembersInput = z.object({ personIds: TICKED });

export type BulkRemoveMembersInput = z.output<typeof bulkRemoveMembersInput> & {
  /** When the act happens: each person's tokens for this workspace issued before it end. */
  readonly at: Date;
};

const bulkRemoveMembersAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: bulkRemoveMembersInput,
  refuses: ["role-forbids", "last-admin", "changed-meanwhile"],
  effect: "write",
});

export type BulkRemoveMembersRefusal =
  | MemberRefusal<"role-forbids" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"last-admin">>
  | Error;

/**
 * Ends every ticked membership here and its tokens, or none: removing the workspace's last Admins
 * refuses the set naming each. An id no member here holds, whatever the reason, is skipped.
 */
export const bulkRemoveMembers = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BulkRemoveMembersInput,
): Promise<Result<BulkOutcome, BulkRemoveMembersRefusal>> => {
  const admitted = admit(bulkRemoveMembersAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const admin = admitted.value;
  const personIds = distinct(input.personIds);

  return withMembersHeld(admin, tx, personIds, async (held) => {
    const refused = refusedItemsOf(namedEach(lastAdminsAmong(held, held.rows), "last-admin"));
    if (refused !== undefined) return err(refused);

    const removedAt = { at: input.at, batchId: batchIdFor(held.rows.length) };
    for (const row of held.rows) await memberRemovedHere(admin, tx, row, removedAt);
    return ok(
      outcomeOf(
        personIds,
        held.rows.map((row) => row.personId),
      ),
    );
  });
};

export const bulkAddToGroupInput = z.object({
  groupId: boundarySchemas.group.select.shape.id,
  personIds: TICKED,
});

export type BulkAddToGroupInput = z.output<typeof bulkAddToGroupInput>;

const bulkAddToGroupAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: bulkAddToGroupInput,
  refuses: ["role-forbids", "no-such-group", "no-such-member", "changed-meanwhile"],
  effect: "write",
});

export type BulkAddToGroupRefusal =
  | MemberRefusal<"role-forbids" | "no-such-group" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"no-such-member">>
  | Error;

/** Key-share holds keep the group and each member from going, and wait on no other add. */
const KEY_SHARED_GROUP = `SELECT 1 FROM "group" WHERE workspace_id = $1 AND id = $2 FOR KEY SHARE`;

const KEY_SHARED_MEMBERS = `SELECT user_id FROM member
                       WHERE workspace_id = $1 AND user_id = ANY($2::text[])
                       ORDER BY user_id FOR KEY SHARE`;

type Adding = { readonly groupId: GroupId; readonly personIds: readonly UserId[] };

const addedUnderKeyShare = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  asked: Adding,
): Promise<Result<BulkOutcome, Exclude<BulkAddToGroupRefusal, Error>>> => {
  const group = await tx.query(KEY_SHARED_GROUP, [admin.workspaceId, asked.groupId]);
  if (group.rows[0] === undefined) return err("no-such-group");
  const held = await tx.query<{ user_id: string }>(KEY_SHARED_MEMBERS, [
    admin.workspaceId,
    asked.personIds,
  ]);
  const members = held.rows.map((row) => PERSON_ID.parse(row.user_id));
  const refused = refusedItemsOf(namedEach(notAmong(asked.personIds, members), "no-such-member"));
  if (refused !== undefined) return err(refused);

  const added = await addedToGroup(admin, tx, { groupId: asked.groupId, personIds: members });
  return ok(outcomeOf(asked.personIds, added));
};

/**
 * Adds every ticked member to the group, or no one: an id no member here holds refuses the set
 * naming each. One already in the group is skipped, counted from what the insert landed.
 */
export const bulkAddToGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BulkAddToGroupInput,
): Promise<Result<BulkOutcome, BulkAddToGroupRefusal>> => {
  const admitted = admit(bulkAddToGroupAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const asked = { groupId: input.groupId, personIds: distinct(input.personIds) };

  const done = await attempt(() => addedUnderKeyShare(admitted.value, tx, asked));
  return done.ok ? done.value : err(refusalOfDeadlock(done.error));
};
