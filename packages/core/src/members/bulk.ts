import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { batchIdFor } from "../audit/index.ts";
import {
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  ok,
  requireFreshConfirmation,
  type AdminUserPrincipal,
  type GroupId,
  type RefusedItems,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import { refusalOfDeadlock, type Tx } from "../store/postgres/index.ts";
import { addedToGroup, heldForAdding } from "./groups.ts";
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

const MOST_TICKED = 200;

const PERSON_ID = boundarySchemas.user.select.shape.id;

const TICKED = z.array(PERSON_ID).min(1).max(MOST_TICKED);

const ROLE = boundarySchemas.member.select.shape.role;

export const bulkChangeRoleInput = z.object({ personIds: TICKED, role: z.string() });

export type BulkChangeRoleInput = z.output<typeof bulkChangeRoleInput> & { readonly at: Date };

const bulkChangeRoleAction = declareAction({
  admits: ADMIN_ALONE,
  input: bulkChangeRoleInput,
  refuses: [
    "role-forbids",
    "no-such-role",
    "no-such-member",
    "last-admin",
    "confirmation-too-old",
    "changed-meanwhile",
  ],
});

type BulkPromoted = { readonly promoted: readonly UserId[] };

export type BulkChangeRoleRefusal =
  | MemberRefusal<"role-forbids" | "no-such-role" | "confirmation-too-old" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"no-such-member" | "last-admin">>
  | Error;

/**
 * All or none: an id no member here holds, or leaving no Admin, refuses the set. A member already
 * at the role is skipped.
 */
export const bulkChangeRole = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BulkChangeRoleInput,
): Promise<Result<BulkOutcome & BulkPromoted, BulkChangeRoleRefusal>> => {
  const admitted = admit(bulkChangeRoleAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const role = ROLE.safeParse(input.role);
  if (!role.success) return err("no-such-role");
  const fresh = requireFreshConfirmation(admitted.value, input.at);
  if (!fresh.ok) return err(fresh.error);
  const admin = fresh.value;
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
    const promoted: UserId[] = [];
    for (const { personId, role: previousRole } of moving) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- every role change runs on the caller's transaction
      if (await roleWritten(admin, tx, { personId, previousRole, role: role.data }, batchId)) {
        promoted.push(personId);
      }
    }
    return ok({
      ...outcomeOf(
        personIds,
        moving.map((row) => row.personId),
      ),
      promoted,
    });
  });
};

export const bulkRemoveMembersInput = z.object({ personIds: TICKED });

export type BulkRemoveMembersInput = z.output<typeof bulkRemoveMembersInput> & {
  readonly at: Date;
};

const bulkRemoveMembersAction = declareAction({
  admits: ADMIN_ALONE,
  input: bulkRemoveMembersInput,
  refuses: ["role-forbids", "last-admin", "confirmation-too-old", "changed-meanwhile"],
});

export type BulkRemoveMembersRefusal =
  | MemberRefusal<"role-forbids" | "confirmation-too-old" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"last-admin">>
  | Error;

/**
 * Ends every ticked member here and their tokens, or none: removing the last Admins refuses the
 * set. An id no member here holds is skipped.
 */
export const bulkRemoveMembers = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BulkRemoveMembersInput,
): Promise<Result<BulkOutcome, BulkRemoveMembersRefusal>> => {
  const admitted = admit(bulkRemoveMembersAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const fresh = requireFreshConfirmation(admitted.value, input.at);
  if (!fresh.ok) return err(fresh.error);

  return withMembersHeld(fresh.value, tx, distinct(input.personIds), async (held) => {
    const refused = refusedItemsOf(namedEach(lastAdminsAmong(held, held.rows), "last-admin"));
    if (refused !== undefined) return err(refused);

    const removedAt = { at: input.at, batchId: batchIdFor(held.rows.length) };
    // oxlint-disable-next-line eslint/no-await-in-loop -- every removal runs on the caller's transaction
    for (const row of held.rows) await memberRemovedHere(fresh.value, tx, row, removedAt);
    return ok(
      outcomeOf(
        input.personIds,
        held.rows.map((row) => row.personId),
      ),
    );
  });
};

export const bulkAddToGroupInput = z.object({
  groupId: boundarySchemas.group.select.shape.id,
  personIds: TICKED,
});

export type BulkAddToGroupInput = z.output<typeof bulkAddToGroupInput> & { readonly at: Date };

const bulkAddToGroupAction = declareAction({
  admits: ADMIN_ALONE,
  input: bulkAddToGroupInput,
  refuses: [
    "role-forbids",
    "no-such-group",
    "no-such-member",
    "confirmation-too-old",
    "changed-meanwhile",
  ],
});

export type BulkAddToGroupRefusal =
  | MemberRefusal<"role-forbids" | "no-such-group" | "confirmation-too-old" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"no-such-member">>
  | Error;

type Adding = { readonly groupId: GroupId; readonly personIds: readonly UserId[] };

const addedUnderKeyShare = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  asked: Adding,
): Promise<Result<BulkOutcome, Exclude<BulkAddToGroupRefusal, Error>>> => {
  const held = await heldForAdding(admin, tx, asked);
  if (!held.ok) return err(held.error);
  const members = held.value;
  const refused = refusedItemsOf(namedEach(notAmong(asked.personIds, members), "no-such-member"));
  if (refused !== undefined) return err(refused);

  const added = await addedToGroup(admin, tx, { groupId: asked.groupId, personIds: members });
  return ok(outcomeOf(asked.personIds, added));
};

/**
 * Adds every ticked member to the group, or no one: an id no member here holds refuses the set. One
 * already in it is skipped.
 */
export const bulkAddToGroup = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BulkAddToGroupInput,
): Promise<Result<BulkOutcome, BulkAddToGroupRefusal>> => {
  const admitted = admit(bulkAddToGroupAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const fresh = requireFreshConfirmation(admitted.value, input.at);
  if (!fresh.ok) return err(fresh.error);
  const asked = { groupId: input.groupId, personIds: distinct(input.personIds) };

  const done = await attempt(() => addedUnderKeyShare(fresh.value, tx, asked));
  return done.ok ? done.value : err(refusalOfDeadlock(done.error));
};
