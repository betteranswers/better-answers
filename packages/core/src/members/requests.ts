import {
  ACCESS_REQUEST_OPEN_STATUS,
  boundarySchemas,
  INVITATION_EXPIRY_SECONDS,
} from "@better-answers/schema";
import type { z } from "zod";

import { act, declareActs, record, recordFor } from "../audit/index.ts";
import type { DetailOf, LedgerAct } from "../audit/index.ts";
import {
  actorIdOfPerson,
  attempt,
  err,
  ok,
  refusalFor,
  requireAdmin,
  type AccessRequestId,
  type AdminUserPrincipal,
  type PlatformPrincipal,
  type Result,
  type Role,
  type RoleRefusal,
  type UserId,
  type UserPrincipal,
  ulid,
} from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withScope } from "../store/postgres/index.ts";
import { workspaceIdBySlug } from "../workspaces/index.ts";

const REQUEST_ACTS = declareActs("people", {
  asked: act("people.request.asked", { requesterId: "id" }),
  approved: act("people.request.approved", {
    requesterId: "id",
    role: "role",
    invitationId: "id",
  }),
  declined: act("people.request.declined", { requesterId: "id" }),
});

export const REQUEST_ROLE_DEFAULT = "Viewer" satisfies Role;

export type Acknowledgement = { readonly acknowledged: true };

const ACKNOWLEDGED: Acknowledgement = { acknowledged: true };

export type RequestAccessInput = {
  readonly slug: string;

  readonly requesterId: string;

  readonly reason: string;
};

export type RequestAccessRefusal = "malformed";

const NEUTRAL_CONSTRAINTS = {
  access_request_waiting_uidx: "already-waiting",
  access_request_requester_id_user_id_fk: "no-such-person",
} as const;

export const requestAccess = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RequestAccessInput,
): Promise<Result<Acknowledgement, RequestAccessRefusal | Error>> => {
  const requester = boundarySchemas.user.select.shape.id.safeParse(input.requesterId);
  const reason = boundarySchemas.accessRequest.insert.shape.reason.safeParse(input.reason);
  if (!requester.success || !reason.success) return err("malformed");

  const workspace = await workspaceIdBySlug(platform, door, input.slug);
  if (!workspace.ok) return err(workspace.error);
  const workspaceId = workspace.value;
  if (workspaceId === undefined) return ok(ACKNOWLEDGED);

  const asked = await attempt(() =>
    withScope(platform, door, workspaceId, async (tx) => {
      const membership = await tx.query(
        "SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, requester.data],
      );
      if ((membership.rowCount ?? 0) > 0) return;

      const id = ulid();
      await recordFor(platform, tx, {
        id: ulid(),
        actor: actorIdOfPerson(requester.data),
        act: REQUEST_ACTS.asked,
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

export type DecideRefusal = RoleRefusal | "malformed" | "no-such-request" | "already-decided";

export type ApproveRefusal = DecideRefusal | "no-such-role";

type Claim = {
  readonly admin: AdminUserPrincipal;
  readonly requestId: AccessRequestId;
  readonly requesterId: UserId;

  readonly email: string;
};

const claimForDecision = async (
  principal: UserPrincipal,
  tx: Tx,
  wanted: string,
): Promise<Result<Claim, DecideRefusal | Error>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
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
    admin: admin.value,
    requestId: requestId.data,
    requesterId: boundarySchemas.user.select.shape.id.parse(row.requester_id),
    email: row.email,
  });
};

const landDecision = async <A extends LedgerAct>(
  admin: AdminUserPrincipal,
  tx: Tx,
  requestId: AccessRequestId,
  decision: {
    readonly status: AccessRequestStatus;
    readonly act: A;
    readonly detail: DetailOf<A["detail"]>;

    readonly invitationId: string | null;
  },
): Promise<Result<undefined, Error>> => {
  await record(admin, tx, {
    id: ulid(),
    act: decision.act,
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

export type ApproveRequestInput = {
  readonly requestId: string;

  readonly role?: string;
};

export type Approved = {
  readonly requestId: AccessRequestId;
  readonly invitationId: string;
  readonly role: Role;
};

export const approveRequest = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ApproveRequestInput,
  now: Date,
): Promise<Result<Approved, ApproveRefusal | Error>> => {
  const claimed = await claimForDecision(principal, tx, input.requestId);
  if (!claimed.ok) return err(claimed.error);
  const { admin, requestId } = claimed.value;

  const role = boundarySchemas.member.select.shape.role.safeParse(
    input.role ?? REQUEST_ROLE_DEFAULT,
  );
  if (!role.success) return err("no-such-role");

  const invitation = boundarySchemas.invitation.insert.safeParse({
    id: ulid(),
    workspaceId: admin.workspaceId,
    email: claimed.value.email,
    role: role.data,

    expiresAt: new Date(now.getTime() + INVITATION_EXPIRY_SECONDS * 1000),
    inviterId: admin.userId,
  });
  if (!invitation.success) return err("malformed");

  const minted = await attempt(() =>
    tx.query(
      `INSERT INTO invitation (id, workspace_id, email, role, expires_at, inviter_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        invitation.data.id,
        invitation.data.workspaceId,
        invitation.data.email,
        invitation.data.role,
        invitation.data.expiresAt,
        invitation.data.inviterId,
      ],
    ),
  );
  if (!minted.ok) return err(minted.error);

  const decided = await landDecision(admin, tx, requestId, {
    status: "approved",
    act: REQUEST_ACTS.approved,
    detail: {
      requesterId: claimed.value.requesterId,
      role: role.data,
      invitationId: invitation.data.id,
    },
    invitationId: invitation.data.id,
  });
  if (!decided.ok) return err(decided.error);

  return ok({ requestId, invitationId: invitation.data.id, role: role.data });
};

export type DeclineRequestInput = { readonly requestId: string };

export const declineRequest = async (
  principal: UserPrincipal,
  tx: Tx,
  input: DeclineRequestInput,
): Promise<Result<{ requestId: AccessRequestId }, DecideRefusal | Error>> => {
  const claimed = await claimForDecision(principal, tx, input.requestId);
  if (!claimed.ok) return err(claimed.error);
  const { admin, requestId } = claimed.value;

  const decided = await landDecision(admin, tx, requestId, {
    status: "declined",
    act: REQUEST_ACTS.declined,
    detail: { requesterId: claimed.value.requesterId },
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

export const listWaitingRequests = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly WaitingRequest[], RoleRefusal | Error>> => {
  const admin = requireAdmin(principal);
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
