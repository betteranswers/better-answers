import { z } from "zod";

import { ACCESS_REQUEST_OPEN_STATUS, boundarySchemas } from "@better-answers/schema";

import { action, declareActions, record, recordFor } from "../audit/index.ts";
import type { DetailOf, AuditAction } from "../audit/index.ts";
import {
  actorIdOfPerson,
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  ok,
  refusalFor,
  type AccessRequestId,
  type AdminUserPrincipal,
  type PlatformPrincipal,
  type RefusalOf,
  type Result,
  type Role,
  type UserId,
  type UserPrincipal,
  ulid,
} from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withScope } from "../store/postgres/index.ts";
import { workspaceIdByShortName } from "../workspaces/index.ts";
import { mintInvitation, type InvitationToSend } from "./invitations.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const REQUEST_ACTIONS = declareActions("people", {
  asked: action("people.request.asked", { requesterId: "id" }),
  approved: action("people.request.approved", {
    requesterId: "id",
    role: "role",
    invitationId: "id",
  }),
  declined: action("people.request.declined", { requesterId: "id" }),
});

/** The role an approval grants when it names none. */
export const REQUEST_ROLE_DEFAULT = "Viewer" satisfies Role;

export type Acknowledgement = { readonly acknowledged: true };

const ACKNOWLEDGED: Acknowledgement = { acknowledged: true };

/** What a person sends: the requester is the session's own person, never a field they fill. */
export const requestAccessInput = z.object({ shortName: z.string(), reason: z.string() });

export type RequestAccessInput = {
  readonly shortName: string;

  readonly requesterId: string;

  readonly reason: string;
};

export type RequestAccessRefusal = MemberRefusal<"malformed">;

const NEUTRAL_CONSTRAINTS = {
  access_request_waiting_uidx: "already-waiting",
  access_request_requester_id_user_id_fk: "no-such-person",
} as const;

/**
 * Acknowledges alike whether a request was written, one already waits, the requester is a member
 * or unknown, or no workspace has the short name, so the answer reveals none of these. Only a malformed
 * requester or reason is refused.
 */
export const requestAccess = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RequestAccessInput,
): Promise<Result<Acknowledgement, RequestAccessRefusal | Error>> => {
  const requester = boundarySchemas.user.select.shape.id.safeParse(input.requesterId);
  const reason = boundarySchemas.accessRequest.insert.shape.reason.safeParse(input.reason);
  if (!requester.success || !reason.success) return err("malformed");

  const workspace = await workspaceIdByShortName(platform, door, input.shortName);
  if (!workspace.ok) return err(workspace.error);
  const workspaceId = workspace.value;
  if (workspaceId === undefined) return ok(ACKNOWLEDGED);

  const asked = await attempt(() =>
    withScope(platform, door, workspaceId, async (tx) => {
      const member = await tx.query(
        "SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, requester.data],
      );
      if ((member.rowCount ?? 0) > 0) return;

      const id = ulid();
      await recordFor(platform, tx, {
        id: ulid(),
        actor: actorIdOfPerson(requester.data),
        action: REQUEST_ACTIONS.asked,
        subjectId: id,
        detail: { requesterId: requester.data },
      });
      await tx.query(
        "INSERT INTO access_request (id, workspace_id, requester_id, reason) VALUES ($1, $2, $3, $4)",
        [id, workspaceId, requester.data, reason.data],
      );
    }),
  );
  if (asked.ok) return ok(ACKNOWLEDGED);

  if (typeof refusalFor(asked.error, NEUTRAL_CONSTRAINTS) === "string") return ok(ACKNOWLEDGED);
  return err(asked.error);
};

type AccessRequestStatus = z.infer<typeof boundarySchemas.accessRequest.select>["status"];

type Claim = {
  readonly admin: AdminUserPrincipal;
  readonly requestId: AccessRequestId;
  readonly requesterId: UserId;

  readonly email: string;
};

/** Takes its face's admission as answered, and passes a refusal on before it reads a row. */
const claimForDecision = async (
  admitted: Result<AdminUserPrincipal, MemberRefusal<"role-forbids">>,
  tx: Tx,
  wanted: string,
): Promise<Result<Claim, DecideRefusal | Error>> => {
  if (!admitted.ok) return err(admitted.error);
  const requestId = boundarySchemas.accessRequest.select.shape.id.safeParse(wanted);
  if (!requestId.success) return err("malformed");

  const found = await attempt(() =>
    tx.query<{ status: string; requester_id: string; email: string }>(
      `SELECT r.status, r.requester_id, u.email
         FROM access_request r JOIN "user" u ON u.id = r.requester_id
        WHERE r.id = $1 FOR UPDATE OF r`,
      [requestId.data],
    ),
  );
  if (!found.ok) return err(found.error);
  const row = found.value.rows[0];
  if (row === undefined) return err("no-such-request");
  if (row.status !== ACCESS_REQUEST_OPEN_STATUS) return err("already-decided");
  return ok({
    admin: admitted.value,
    requestId: requestId.data,
    requesterId: boundarySchemas.user.select.shape.id.parse(row.requester_id),
    email: row.email,
  });
};

const landDecision = async <A extends AuditAction>(
  admin: AdminUserPrincipal,
  tx: Tx,
  requestId: AccessRequestId,
  decision: {
    readonly status: AccessRequestStatus;
    readonly action: A;
    readonly detail: DetailOf<A["detail"]>;

    readonly invitationId: string | null;
  },
): Promise<Result<undefined, Error>> => {
  await record(admin, tx, {
    id: ulid(),
    action: decision.action,
    subjectId: requestId,
    detail: decision.detail,
  });
  const decided = await attempt(() =>
    tx.query(
      `UPDATE access_request
          SET status = $2, decided_by = $3, decided_at = now(), invitation_id = $4
        WHERE id = $1`,
      [requestId, decision.status, admin.userId, decision.invitationId],
    ),
  );
  if (!decided.ok) return err(decided.error);
  return ok(undefined);
};

export const approveRequestInput = z.object({
  requestId: z.string(),
  role: z.string().optional(),
});

export type ApproveRequestInput = z.output<typeof approveRequestInput> & { readonly now: Date };

const approveRequestAction = declareAction({
  admits: ADMIN_ALONE,
  input: approveRequestInput,
  refuses: [
    "role-forbids",
    "malformed",
    "no-such-request",
    "already-decided",
    "no-such-role",
    "off-testing-domain",
  ],
});

export type ApproveRefusal = MemberRefusal<RefusalOf<typeof approveRequestAction>>;

/** The invitation the approval minted, which the transport emails once the approval commits. */
export type Approved = InvitationToSend & { readonly requestId: AccessRequestId };

/**
 * Mints an invitation to the requester's address at `role`, or `REQUEST_ROLE_DEFAULT`, through the
 * one step a direct invite takes. The request row is locked, so of two decisions at once the
 * second answers `already-decided`.
 */
export const approveRequest = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ApproveRequestInput,
): Promise<Result<Approved, ApproveRefusal | Error>> => {
  const admitted = admit(approveRequestAction, principal, input);
  const claimed = await claimForDecision(admitted, tx, input.requestId);
  if (!claimed.ok) return err(claimed.error);
  const { admin, requestId } = claimed.value;

  const role = boundarySchemas.member.select.shape.role.safeParse(
    input.role ?? REQUEST_ROLE_DEFAULT,
  );
  if (!role.success) return err("no-such-role");

  const minted = await mintInvitation(admin, tx, {
    address: claimed.value.email,
    role: role.data,
    now: input.now,
  });
  if (!minted.ok) return err(minted.error);
  const { invitationId } = minted.value;

  const decided = await landDecision(admin, tx, requestId, {
    status: "approved",
    action: REQUEST_ACTIONS.approved,
    detail: { requesterId: claimed.value.requesterId, role: role.data, invitationId },
    invitationId,
  });
  if (!decided.ok) return err(decided.error);

  return ok({ ...minted.value, requestId });
};

export const declineRequestInput = z.object({ requestId: z.string() });

export type DeclineRequestInput = z.output<typeof declineRequestInput>;

const declineRequestAction = declareAction({
  admits: ADMIN_ALONE,
  input: declineRequestInput,
  refuses: ["role-forbids", "malformed", "no-such-request", "already-decided"],
});

export type DecideRefusal = MemberRefusal<RefusalOf<typeof declineRequestAction>>;

export const declineRequest = async (
  principal: UserPrincipal,
  tx: Tx,
  input: DeclineRequestInput,
): Promise<Result<{ requestId: AccessRequestId }, DecideRefusal | Error>> => {
  const admitted = admit(declineRequestAction, principal, input);
  const claimed = await claimForDecision(admitted, tx, input.requestId);
  if (!claimed.ok) return err(claimed.error);
  const { admin, requestId, requesterId } = claimed.value;

  const decided = await landDecision(admin, tx, requestId, {
    status: "declined",
    action: REQUEST_ACTIONS.declined,
    detail: { requesterId },
    invitationId: null,
  });
  if (!decided.ok) return err(decided.error);

  return ok({ requestId });
};

export type WaitingRequest = {
  readonly id: AccessRequestId;
  readonly requester: { readonly id: UserId; readonly name: string; readonly email: string };
  readonly reason: string;
  readonly askedAt: Date;
};

const listWaitingRequestsAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

/** Oldest first. */
export const listWaitingRequests = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<
  Result<
    readonly WaitingRequest[],
    MemberRefusal<RefusalOf<typeof listWaitingRequestsAction>> | Error
  >
> => {
  const admin = admit(listWaitingRequestsAction, principal, {});
  if (!admin.ok) return err(admin.error);

  const waiting = await attempt(() =>
    tx.query<{
      id: string;
      requester_id: string;
      name: string;
      email: string;
      reason: string;
      created_at: Date;
    }>(
      `SELECT r.id, r.requester_id, u.name, u.email, r.reason, r.created_at
         FROM access_request r JOIN "user" u ON u.id = r.requester_id
        WHERE r.status = $1
        ORDER BY r.created_at, r.id`,
      [ACCESS_REQUEST_OPEN_STATUS],
    ),
  );
  if (!waiting.ok) return err(waiting.error);

  const rows = await attempt(async () =>
    waiting.value.rows.map((row) => ({
      id: boundarySchemas.accessRequest.select.shape.id.parse(row.id),
      requester: {
        id: boundarySchemas.user.select.shape.id.parse(row.requester_id),
        name: row.name,
        email: row.email,
      },
      reason: row.reason,
      askedAt: row.created_at,
    })),
  );
  if (!rows.ok) return err(rows.error);
  return ok(rows.value);
};
