import { z } from "zod";

import {
  boundarySchemas,
  INVITATION_ACCEPTED_STATUS,
  INVITATION_CANCELLED_STATUS,
  INVITATION_WAITING_STATUS,
} from "@better-answers/schema";

import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type AdminUserPrincipal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { ADMIN_ALONE, WAITING_ROW, waitingOf, type WaitingInvitation } from "./invitations.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const INVITATION_STATUSES = ["waiting", "accepted", "expired", "cancelled"] as const;

type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Asked no status, the list is the waiting invitations. */
export const listInvitationsInput = z
  .object({ status: z.enum(INVITATION_STATUSES).default("waiting") })
  .default({ status: "waiting" });

const listInvitationsAct = declareAct({
  admits: ADMIN_ALONE,
  input: listInvitationsInput,
  refuses: ["role-forbids"],
  effect: "read",
});

const countInvitationsAct = declareAct({
  admits: ADMIN_ALONE,
  input: z.object({}),
  refuses: ["role-forbids"],
  effect: "read",
});

export type ListInvitationsRefusal =
  | MemberRefusal<RefusalOf<typeof listInvitationsAct | typeof countInvitationsAct>>
  | Error;

/** The inviter by display name, read from their person row, so it stands after they leave. */
export type ListedInvitation = WaitingInvitation & {
  readonly invitedBy: string;
  readonly status: InvitationStatus;
};

const LISTED_ROW = WAITING_ROW.extend({
  invitedBy: boundarySchemas.user.select.shape.name,
  status: z.enum(INVITATION_STATUSES),
});

export type InvitationCounts = Readonly<Record<InvitationStatus, number>>;

/** By the server's clock: an invitation never accepted is expired from the instant it expires. */
const STATUS_OF = `CASE WHEN i.status = $2 AND i.expires_at > $3 THEN 'waiting'
                        WHEN i.status = $2 THEN 'expired'
                        WHEN i.status = $4 THEN 'accepted'
                        WHEN i.status = $5 THEN 'cancelled' END`;

const statusParameters = (admin: AdminUserPrincipal, at: Date) => [
  admin.workspaceId,
  INVITATION_WAITING_STATUS,
  at,
  INVITATION_ACCEPTED_STATUS,
  INVITATION_CANCELLED_STATUS,
];

const LISTED = `SELECT * FROM (
                  SELECT i.id AS "invitationId", i.email AS address, i.role, i.created_at AS "invitedAt",
                         i.expires_at AS "expiresAt", u.name AS "invitedBy", ${STATUS_OF} AS status
                    FROM invitation i JOIN "user" u ON u.id = i.inviter_id
                   WHERE i.workspace_id = $1
                ) listed
                WHERE status = $6
                ORDER BY "invitedAt" DESC, "invitationId" DESC`;

export type ListInvitationsInput = z.output<typeof listInvitationsInput> & { readonly at: Date };

/** Newest first, each row with its status as of `at`. */
export const listInvitations = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ListInvitationsInput,
): Promise<Result<readonly ListedInvitation[], ListInvitationsRefusal>> => {
  const admitted = admit(listInvitationsAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const listed = await attempt(async () =>
    z
      .array(LISTED_ROW)
      .parse(
        (await tx.query(LISTED, [...statusParameters(admitted.value, input.at), input.status]))
          .rows,
      ),
  );
  if (!listed.ok) return err(listed.error);
  return ok(listed.value.map(waitingOf));
};

const COUNTED = `SELECT status, count(*)::int AS count FROM (
                   SELECT ${STATUS_OF} AS status FROM invitation i WHERE i.workspace_id = $1
                 ) statuses
                 WHERE status IS NOT NULL
                 GROUP BY status`;

const COUNTED_ROW = z.object({ status: z.enum(INVITATION_STATUSES), count: z.int() });

/** How many invitations each status holds as of `at`, from one grouped read. */
export const countInvitations = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly at: Date },
): Promise<Result<InvitationCounts, ListInvitationsRefusal>> => {
  const admitted = admit(countInvitationsAct, principal, {});
  if (!admitted.ok) return err(admitted.error);

  const counted = await attempt(async () =>
    z
      .array(COUNTED_ROW)
      .parse((await tx.query(COUNTED, statusParameters(admitted.value, input.at))).rows),
  );
  if (!counted.ok) return err(counted.error);
  const countOf = (status: InvitationStatus): number =>
    counted.value.find((row) => row.status === status)?.count ?? 0;
  return ok({
    waiting: countOf("waiting"),
    accepted: countOf("accepted"),
    expired: countOf("expired"),
    cancelled: countOf("cancelled"),
  });
};
