import {
  ACCESS_REQUEST_OPEN_STATUS,
  boundarySchemas,
  INVITATION_EXPIRY_SECONDS,
} from "@better-answers/schema";
import type { z } from "zod";

import { act, declareActs, record, recordFor } from "../audit/index.ts";
import type { Act, DetailOf } from "../audit/index.ts";
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

/**
 * The *access request* half of the **members** slice (ADR 0038; `CONTEXT.md`): a signed-in
 * person's recorded ask to join one workspace, and the three verbs an Admin decides it
 * with. Owns `access_request`; writes `invitation` and reads `member` and `user`, each an
 * entry with its reason on the table-ownership map.
 *
 * The four acts differ in who makes them, which is the whole shape of this module:
 *
 * - **Asking** is made by somebody who holds no membership in the workspace they name, and
 *   therefore no Principal — the kinds are closed at three (ADR 0009). It is the
 *   auth-boundary case ADR 0038 states: the transport verifies the live session, this
 *   module performs the write under the **platform principal**, and the ledger row is
 *   booked to the person through the audit slice's second door, whose one caller this is
 *   by decision. It answers **one neutral acknowledgement** whatever happened, so the
 *   surface can never be asked whether a workspace exists.
 * - **Approving, declining and listing** are an Admin's, made inside the transaction the
 *   transport's `withPrincipal` already opened, and refused to every other role by the
 *   kernel's one guard and its one word. The tenant boundary is the policy's: a request row
 *   of another workspace is not in a scoped read at all, so an Admin of one company reaches
 *   another's queue with no verb.
 *
 * Every act writes its event through the audit slice **bare, in the act's own transaction**
 * (ADR 0014 rule 4): the doors reject rather than return, and that rejection is what makes an
 * act and its ledger row land or fail together.
 */

/**
 * The slice's acts on the ledger. The subject is the *request* and the actor is whoever
 * decided it — the requester for the ask, the Admin for the two decisions — so the ledger
 * answers "who let this person in" without joining anything. The detail carries ids and role
 * words and never the reason a person wrote, which is a sentence about themselves
 * (ADR 0038: the ledger is never rewritten, so nothing that would need rewriting goes in it).
 */
const REQUEST_ACTS = declareActs("people", {
  asked: act("people.request.asked", { requesterId: "id" }),
  approved: act("people.request.approved", {
    requesterId: "id",
    role: "role",
    invitationId: "id",
  }),
  declined: act("people.request.declined", { requesterId: "id" }),
});

/**
 * The role a request is approved at when the Admin names none — Viewer, the least of the
 * three, so that the quick decision is the safe one (T-048's user story 16: "pick the role
 * (Viewer unless I say otherwise)"). ADR 0038 fixes the set the role is checked against;
 * which of the three is the default is the spec's.
 */
export const REQUEST_ROLE_DEFAULT = "Viewer" satisfies Role;

/**
 * The one answer the request surface gives. It carries nothing, and that is the point: a
 * value that differed between a real slug, an unknown one, a workspace the person already
 * belongs to and one they are already waiting on would be the oracle ADR 0038 refuses.
 */
export type Acknowledgement = { readonly acknowledged: true };

const ACKNOWLEDGED: Acknowledgement = { acknowledged: true };

export type RequestAccessInput = {
  /** The workspace's slug, as a colleague would have written it down. */
  readonly slug: string;
  /** The person asking — their person id, from the session the transport verified. */
  readonly requesterId: string;
  /** Why they want in; required, and never written to the ledger. */
  readonly reason: string;
};

/**
 * The one refusal, and it says nothing about any workspace: the requester id or the reason
 * is not a shape this act accepts. It is decided from the arguments alone, before the slug
 * is looked up, so a caller cannot read a workspace's existence out of hearing it.
 */
export type RequestAccessRefusal = "malformed";

/**
 * The two refusals the database makes that the acknowledgement has to cover, because each
 * is a fact about *this* workspace that only a resolving slug could produce:
 *
 * - the partial unique index — this person is already waiting here;
 * - the requester's foreign key — the person id is on no identity row, which the transport's
 *   just-verified session makes unreachable in production, but which a caller free to choose
 *   the id would otherwise turn into a slug oracle: an error for a workspace that exists and
 *   an acknowledgement for one that does not.
 */
const NEUTRAL_CONSTRAINTS = {
  access_request_waiting_uidx: "already-waiting",
  access_request_requester_id_user_id_fk: "no-such-person",
} as const;

/**
 * Ask to join a workspace. One transaction: the ledger row booked to the requester, then the
 * request row.
 *
 * **The acknowledgement is the same in four cases** and a row lands in one of them — the
 * slug names a workspace, the slug names none, the person is already a member, the person is
 * already waiting. The first two part before the transaction opens, because an unknown slug
 * has no scope to write in; the third is a read inside it that returns before anything is
 * written; the fourth is the partial unique index refusing the insert, which aborts the
 * transaction and takes the event with it. All four leave the caller holding one value.
 *
 * What is *not* neutral is the shape of the arguments, and that is safe because it is
 * decided before the slug is looked up. Everything decided after it — including a person id
 * on no identity row — is neutral too, or it would be an oracle for a caller who could
 * choose one.
 *
 * **The ledger row is written first on purpose**, as provisioning's is: the failure the
 * fail-together test provokes — a requester who is on no identity row — comes after it, so
 * the test proves the row rolled back with the act rather than that it was never reached.
 */
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
      // Already a member: the acknowledgement, and nothing written — not even the event,
      // because no act was performed. `member` carries no policy (ADR 0009), so the
      // statement names both halves of the pair rather than leaning on the scope.
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
  // A constraint this act names is a fact about the workspace, so it leaves as the
  // acknowledgement and never as itself; `refusalFor` answers the word for one it names and
  // the Error itself for anything else, which is how the two are told apart here. What is
  // left is the store failing — a pool that has gone, and nothing a slug could cause.
  if (typeof refusalFor(asked.error, NEUTRAL_CONSTRAINTS) === "string") return ok(ACKNOWLEDGED);
  return err(asked.error);
};

/**
 * The status a decision moves a request to, read off the boundary that narrows to the closed
 * set (ADR 0028: the schemas, not the tables, are the source of application-level types) —
 * as the kernel's `Role` is.
 */
type AccessRequestStatus = z.infer<typeof boundarySchemas.accessRequest.select>["status"];

/** Why a decision was refused. Each is a fact about this Admin's own workspace. */
export type DecideRefusal = RoleRefusal | "malformed" | "no-such-request" | "already-decided";

/** What approve refuses on top of the four: a role outside the three (ADR 0019). */
export type ApproveRefusal = DecideRefusal | "no-such-role";

/** A waiting request an Admin has taken hold of, and the Admin who did. */
type Claim = {
  readonly admin: AdminUserPrincipal;
  readonly requestId: AccessRequestId;
  readonly requesterId: UserId;
  /** The requester's address, which approve mints the invitation to. */
  readonly email: string;
};

/**
 * The opening both decisions share, in the order they share it: the caller narrowed to an
 * Admin, the id parsed, and the row taken and held until the transaction ends.
 *
 * `FOR UPDATE` on the request alone is what makes the status read here the current one: a
 * concurrent decision either committed before the lock — and is seen — or waits behind it,
 * so the update that follows in the caller cannot find the row already decided.
 *
 * The read is scoped by the policy and by nothing written here, which is how the
 * cross-workspace refusal happens per verb: another workspace's request is not a row this
 * transaction can see, so it answers `no-such-request` exactly as an id nobody minted does.
 */
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

/**
 * Write the decision's event and land it on the row — the half approve and decline share,
 * and the order they share it in: the event first, the row second, so a failure landing the
 * decision takes the event with it rather than leaving a ledger that says more than
 * happened. The door is called here rather than in each act because the two would otherwise
 * be the same six lines twice, and it is called **bare**: its rejection is what aborts the
 * caller's transaction, and a `Result` it handed back could be one the act did not read.
 *
 * The row is held by `claimForDecision`'s lock, so the status has not moved under us and
 * this updates the one row; a `WHERE status` clause would read as a second check where the
 * lock already is the check.
 */
const landDecision = async <A extends Act>(
  admin: AdminUserPrincipal,
  tx: Tx,
  requestId: AccessRequestId,
  decision: {
    readonly status: AccessRequestStatus;
    readonly act: A;
    readonly detail: DetailOf<A["detail"]>;
    /** What approve minted; `null` on a decline, which mints nothing. */
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
  /** The role the person joins at; `Viewer` when the Admin does not choose one. */
  readonly role?: string;
};

export type Approved = {
  readonly requestId: AccessRequestId;
  readonly invitationId: string;
  readonly role: Role;
};

/**
 * Approve a request: mint the invitation and record it on the row, in one transaction with
 * the event. Admin only.
 *
 * **The invitation is written as a row**, through the identity-write seam the
 * credentials-revocation act set — not through Better Auth's endpoint, which core never
 * imports and never calls (ADR 0038). T-004's two invitation fences therefore stand
 * untouched: they fence the library's own `beforeCreateInvitation` and
 * `beforeAcceptInvitation` hooks, and this act crosses neither. **No email is sent here** —
 * an emailed invitation with no accept page would only sit pending, which is the fences'
 * own reasoning; sending it is T-027's, with the page.
 *
 * The row is claimed first, the invitation minted second, the event written third and the
 * decision landed last, so that a failure anywhere after the claim takes the whole act with
 * it — an approved request never exists without the invitation it names, and neither exists
 * without the ledger row that says who let this person in. The role is checked after the
 * claim and before anything is written, so an Editor asking for a role that does not exist
 * still hears the refusal their role earns rather than the one their argument would.
 */
export const approveRequest = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ApproveRequestInput,
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
    // The library's own default, read off the installed plugin rather than remembered;
    // `status` is left to the column's default, which is the plugin's own too.
    expiresAt: new Date(Date.now() + INVITATION_EXPIRY_SECONDS * 1000),
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

/**
 * Decline a request: record who said no, in one transaction with the event. Admin only.
 * Nothing else happens — the person keeps no membership and gains no invitation, and may
 * ask again, because the partial unique index only holds the waiting rows.
 */
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

/** One waiting request as the Admin's queue shows it: who asked, when, and why. */
export type WaitingRequest = {
  readonly id: AccessRequestId;
  readonly requester: { readonly id: UserId; readonly name: string; readonly email: string };
  readonly reason: string;
  readonly askedAt: Date;
};

/**
 * The Admin's queue: every request still waiting in this workspace, oldest first. Admin
 * only, and scoped by the policy — an Admin of another workspace sees an empty queue rather
 * than a refusal, because there is nothing of theirs here to refuse.
 *
 * It names each requester rather than handing back a person id alone: the Admin is deciding
 * whether to admit a person, and the address is the thing they judge them by. That is a read
 * of the identity set by the ids already on this workspace's own rows, and it writes no
 * ledger row, because a read is not an act (ADR 0038).
 */
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
