import { z } from "zod";

import { INVITATION_CANCELLED_STATUS, INVITATION_WAITING_STATUS } from "@better-answers/schema";

import { recordEach } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type AdminUserPrincipal,
  type CeilingMet,
  type KernelRefusal,
  type RefusedItems,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { refusalOfDeadlock, type Tx } from "../store/postgres/index.ts";
import { waitingCounted } from "./invitation-ceilings.ts";
import {
  ADMIN_ALONE,
  expiryFrom,
  INVITATION_ACTS,
  INVITATION_ID,
  MOST_AT_ONCE,
  NO_SUCH_INVITATION,
  RETURNED,
  WAITING_ROW,
  waitingOf,
  workspaceNameOf,
  type InvitationToSend,
} from "./invitations.ts";
import {
  distinct,
  namedEach,
  notAmong,
  outcomeOf,
  refusedItemsOf,
  type BulkOutcome,
} from "./sets.ts";
import type { MemberRefusal } from "./vocabulary.ts";

export const bulkInvitationsInput = z.object({
  invitationIds: z.array(INVITATION_ID).min(1).max(MOST_AT_ONCE),
});

const ON_A_SET: readonly MemberRefusal<
  "role-forbids" | "no-such-invitation" | "changed-meanwhile"
>[] = ["role-forbids", "no-such-invitation", "changed-meanwhile"];

const bulkResendInvitationsAct = declareAct({
  admits: ADMIN_ALONE,
  input: bulkInvitationsInput,
  refuses: ON_A_SET,
  effect: "write",
});

const bulkCancelInvitationsAct = declareAct({
  admits: ADMIN_ALONE,
  input: bulkInvitationsInput,
  refuses: ON_A_SET,
  effect: "write",
});

type SetRefusal =
  | MemberRefusal<"role-forbids">
  | KernelRefusal<"changed-meanwhile">
  | RefusedItems<MemberRefusal<"no-such-invitation">>
  | Error;

export type BulkResendInvitationsRefusal = SetRefusal;

export type BulkCancelInvitationsRefusal = SetRefusal;

/** One statement, in id order, so two acts holding overlapping sets take them alike. */
const HELD_INVITATIONS = `SELECT id, status FROM invitation
                           WHERE workspace_id = $1 AND id = ANY($2::text[])
                           ORDER BY id FOR UPDATE`;

/** Each id asked for and held here in none of `standing`, named `no-such-invitation`. */
const refusedOutside = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  invitationIds: readonly string[],
  standing: readonly string[],
): Promise<RefusedItems<MemberRefusal<"no-such-invitation">> | undefined> => {
  const held = await tx.query<{ id: string; status: string }>(HELD_INVITATIONS, [
    admin.workspaceId,
    invitationIds,
  ]);
  const found = held.rows.filter((row) => standing.includes(row.status)).map((row) => row.id);
  return refusedItemsOf(namedEach(notAmong(invitationIds, found), NO_SUCH_INVITATION));
};

const RENEWED_EACH = `WITH renewed AS (
                        UPDATE invitation SET expires_at = $3
                         WHERE workspace_id = $1 AND id = ANY($2::text[])
                        RETURNING ${RETURNED}
                      )
                      SELECT * FROM renewed ORDER BY "invitationId"`;

type Renewing = { readonly invitationIds: readonly string[]; readonly now: Date };

const renewedUnderHold = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  renewing: Renewing,
): Promise<
  Result<
    readonly InvitationToSend[],
    RefusedItems<MemberRefusal<"no-such-invitation">> | CeilingMet
  >
> => {
  const { invitationIds, now } = renewing;
  const counted = await waitingCounted(admin, tx, invitationIds, now);
  if (!counted.ok) return err(counted.error);
  const refused = await refusedOutside(admin, tx, invitationIds, [INVITATION_WAITING_STATUS]);
  if (refused !== undefined) return err(refused);

  const renewed = await tx.query(RENEWED_EACH, [admin.workspaceId, invitationIds, expiryFrom(now)]);
  const invitations = z.array(WAITING_ROW).parse(renewed.rows).map(waitingOf);
  await recordEach(
    admin,
    tx,
    INVITATION_ACTS.resent,
    invitations.map(({ invitationId }) => ({ subjectId: invitationId, detail: {} })),
  );
  const workspaceName = await workspaceNameOf(admin, tx);
  return ok(invitations.map((invitation) => ({ ...invitation, workspaceName })));
};

export type BulkResendInvitationsInput = z.output<typeof bulkInvitationsInput> & {
  readonly now: Date;
};

/**
 * Renews every ticked invitation a week from `now`, or none: one accepted, cancelled or not held
 * here refuses the set naming each. Past an address's ceiling or the workspace's, the set fails
 * whole.
 */
export const bulkResendInvitations = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BulkResendInvitationsInput,
): Promise<Result<readonly InvitationToSend[], BulkResendInvitationsRefusal>> => {
  const admitted = admit(bulkResendInvitationsAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const renewing = { invitationIds: distinct(input.invitationIds), now: input.now };

  const done = await attempt(() => renewedUnderHold(admitted.value, tx, renewing));
  return done.ok ? done.value : err(refusalOfDeadlock(done.error));
};

const CANCELLED_WAITING = `WITH cancelled AS (
                             UPDATE invitation SET status = $3
                              WHERE workspace_id = $1 AND id = ANY($2::text[]) AND status = $4
                             RETURNING id
                           )
                           SELECT id FROM cancelled ORDER BY id`;

const cancelledUnderHold = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  invitationIds: readonly string[],
): Promise<Result<BulkOutcome<string>, RefusedItems<MemberRefusal<"no-such-invitation">>>> => {
  const refused = await refusedOutside(admin, tx, invitationIds, [
    INVITATION_WAITING_STATUS,
    INVITATION_CANCELLED_STATUS,
  ]);
  if (refused !== undefined) return err(refused);

  const cancelled = await tx.query<{ id: string }>(CANCELLED_WAITING, [
    admin.workspaceId,
    invitationIds,
    INVITATION_CANCELLED_STATUS,
    INVITATION_WAITING_STATUS,
  ]);
  const changed = cancelled.rows.map((row) => INVITATION_ID.parse(row.id));
  await recordEach(
    admin,
    tx,
    INVITATION_ACTS.cancelled,
    changed.map((subjectId) => ({ subjectId, detail: {} })),
  );
  return ok(outcomeOf<string>(invitationIds, changed));
};

/**
 * Cancels every ticked invitation still waiting, or none: one accepted or not held here refuses
 * the set naming each. One already cancelled is skipped, counted from what the update landed.
 */
export const bulkCancelInvitations = async (
  principal: UserPrincipal,
  tx: Tx,
  input: z.output<typeof bulkInvitationsInput>,
): Promise<Result<BulkOutcome<string>, BulkCancelInvitationsRefusal>> => {
  const admitted = admit(bulkCancelInvitationsAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const invitationIds = distinct(input.invitationIds);

  const done = await attempt(() => cancelledUnderHold(admitted.value, tx, invitationIds));
  return done.ok ? done.value : err(refusalOfDeadlock(done.error));
};
