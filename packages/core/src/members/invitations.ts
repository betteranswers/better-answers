import {
  boundarySchemas,
  INVITATION_CANCELLED_STATUS,
  INVITATION_EXPIRY_SECONDS,
  INVITATION_WAITING_STATUS,
} from "@better-answers/schema";
import { z } from "zod";

import { act, declareActs, record } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type AdminUserPrincipal,
  type RefusalOf,
  type Result,
  type Role,
  type UserPrincipal,
  ulid,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { WORKSPACE_REFUSALS } from "../workspaces/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const INVITATION_ACTS = declareActs("people", {
  created: act("people.invitation.created", { role: "role", replacedInvitationId: "id?" }),
  resent: act("people.invitation.resent", {}),
  cancelled: act("people.invitation.cancelled", {}),
});

const ROLE = boundarySchemas.member.select.shape.role;

const INVITATION_ID = boundarySchemas.invitation.select.shape.id;

/** Longer than any address a mail system delivers to, so a real one is never refused. */
const ADDRESS = z.email().max(254);

const ADMIN_ALONE = { role: "Admin", purposes: [] } as const;

export const inviteMemberInput = z.object({ address: z.string(), role: z.string() });

const inviteMemberAct = declareAct({
  admits: ADMIN_ALONE,
  input: inviteMemberInput,
  refuses: ["role-forbids", "malformed", "no-such-role", "already-a-member"],
  effect: "write",
});

export const invitationInput = z.object({ invitationId: z.string() });

type OnAnInvitationRefusal = MemberRefusal<"role-forbids" | "malformed" | "no-such-invitation">;

const ON_AN_INVITATION: readonly OnAnInvitationRefusal[] = [
  "role-forbids",
  "malformed",
  "no-such-invitation",
];

const resendInvitationAct = declareAct({
  admits: ADMIN_ALONE,
  input: invitationInput,
  refuses: ON_AN_INVITATION,
  effect: "write",
});

const cancelInvitationAct = declareAct({
  admits: ADMIN_ALONE,
  input: invitationInput,
  refuses: ON_AN_INVITATION,
  effect: "write",
});

const listInvitationsAct = declareAct({
  admits: ADMIN_ALONE,
  input: z.object({}),
  refuses: ["role-forbids"],
  effect: "read",
});

/** Borrowed from the workspaces slice, whose word it is: joining refuses a member in it too. */
type AlreadyAMember = Extract<keyof typeof WORKSPACE_REFUSALS, "already-a-member">;

export type InviteMemberRefusal =
  | MemberRefusal<Exclude<RefusalOf<typeof inviteMemberAct>, AlreadyAMember>>
  | AlreadyAMember
  | Error;

export type ResendInvitationRefusal = MemberRefusal<RefusalOf<typeof resendInvitationAct>> | Error;

export type CancelInvitationRefusal = MemberRefusal<RefusalOf<typeof cancelInvitationAct>> | Error;

export type ListInvitationsRefusal = MemberRefusal<RefusalOf<typeof listInvitationsAct>> | Error;

const LISTED_ROW = z.object({
  invitationId: INVITATION_ID,
  address: boundarySchemas.invitation.select.shape.email,
  role: ROLE,
  invitedAt: boundarySchemas.invitation.select.shape.createdAt,
  expiresAt: boundarySchemas.invitation.select.shape.expiresAt,
});

type ListedRow = z.output<typeof LISTED_ROW>;

/** The instants are ISO strings, which is what a `Date` becomes on the wire anyway. */
export type WaitingInvitation = Omit<ListedRow, "invitedAt" | "expiresAt"> & {
  readonly invitedAt: string;
  readonly expiresAt: string;
};

/** What the email to the invited address is written from. */
export type InvitationToSend = WaitingInvitation & { readonly workspaceName: string };

const RETURNED = `id AS "invitationId", email AS address, role, created_at AS "invitedAt",
                  expires_at AS "expiresAt"`;

const waitingOf = (row: ListedRow): WaitingInvitation => ({
  ...row,
  invitedAt: row.invitedAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

const expiryFrom = (now: Date): Date => new Date(now.getTime() + INVITATION_EXPIRY_SECONDS * 1000);

// The parse brands the ids; a row it throws on fails the act like the query would.
const oneWaiting = async (
  query: () => Promise<{ readonly rows: readonly unknown[] }>,
): Promise<Result<WaitingInvitation | undefined, Error>> => {
  const read = await attempt(async () => {
    const [row] = (await query()).rows;
    return row === undefined ? undefined : waitingOf(LISTED_ROW.parse(row));
  });
  return read.ok ? ok(read.value) : err(read.error);
};

const toSend = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  invitation: WaitingInvitation,
): Promise<Result<InvitationToSend, Error>> => {
  const named = await attempt(() =>
    tx.query<{ name: string }>("SELECT name FROM workspace WHERE id = $1", [admin.workspaceId]),
  );
  if (!named.ok) return err(named.error);
  const workspaceName = named.value.rows[0]?.name;
  if (workspaceName === undefined) return err(new Error("members: the workspace has no row"));
  return ok({ ...invitation, workspaceName });
};

export type MintInvitationInput = {
  /** Lower-cased here, however the Admin or the person's own row spelled it. */
  readonly address: string;
  readonly role: Role;
  readonly now: Date;
};

/**
 * The one step every invitation is minted by: a direct invite and an approved access request
 * alike. It cancels the address's waiting invitation in the same transaction, so only the newest
 * link stands, and writes `people.invitation.created`.
 */
export const mintInvitation = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  input: MintInvitationInput,
): Promise<Result<InvitationToSend, Error>> => {
  const address = input.address.toLowerCase();
  const { workspaceId } = admin;

  // Two invitations to one address queue here, so the later replaces the earlier rather than
  // failing on the index.
  const replaced = await attempt(async () => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('invitation'), hashtext($1 || ' ' || $2))",
      [workspaceId, address],
    );
    return tx.query<{ id: string }>(
      `UPDATE invitation SET status = $3
        WHERE workspace_id = $1 AND lower(email) = $2 AND status = $4
       RETURNING id`,
      [workspaceId, address, INVITATION_CANCELLED_STATUS, INVITATION_WAITING_STATUS],
    );
  });
  if (!replaced.ok) return err(replaced.error);

  const invitationId = ulid();
  const minted = await oneWaiting(() =>
    tx.query(
      `INSERT INTO invitation (id, workspace_id, email, role, status, created_at, expires_at, inviter_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${RETURNED}`,
      [
        invitationId,
        workspaceId,
        address,
        input.role,
        INVITATION_WAITING_STATUS,
        input.now,
        expiryFrom(input.now),
        admin.userId,
      ],
    ),
  );
  if (!minted.ok) return err(minted.error);
  if (minted.value === undefined) return err(new Error("members: the invitation was not written"));

  const replacedInvitationId = replaced.value.rows[0]?.id;
  await record(admin, tx, {
    id: ulid(),
    act: INVITATION_ACTS.created,
    subjectId: invitationId,
    detail:
      replacedInvitationId === undefined
        ? { role: input.role }
        : { role: input.role, replacedInvitationId },
  });
  return toSend(admin, tx, minted.value);
};

const isMember = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  address: string,
): Promise<Result<boolean, Error>> => {
  const found = await attempt(() =>
    tx.query(
      `SELECT 1 FROM member m JOIN "user" u ON u.id = m.user_id
        WHERE m.workspace_id = $1 AND lower(u.email) = $2`,
      [admin.workspaceId, address],
    ),
  );
  return found.ok ? ok((found.value.rowCount ?? 0) > 0) : err(found.error);
};

export type InviteMemberInput = z.output<typeof inviteMemberInput> & { readonly now: Date };

/**
 * Answers alike whether or not the address belongs to a person on the platform; only a current
 * member of this workspace is refused, `already-a-member`.
 */
export const inviteMember = async (
  principal: UserPrincipal,
  tx: Tx,
  input: InviteMemberInput,
): Promise<Result<InvitationToSend, InviteMemberRefusal>> => {
  const admitted = admit(inviteMemberAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const address = ADDRESS.safeParse(input.address.trim().toLowerCase());
  if (!address.success) return err("malformed");
  const role = ROLE.safeParse(input.role);
  if (!role.success) return err("no-such-role");

  const member = await isMember(admitted.value, tx, address.data);
  if (!member.ok) return err(member.error);
  if (member.value) return err("already-a-member");

  return mintInvitation(admitted.value, tx, {
    address: address.data,
    role: role.data,
    now: input.now,
  });
};

export type ResendInvitationInput = z.output<typeof invitationInput> & { readonly now: Date };

/** A resent invitation keeps its link and runs seven days from `now`, as the new email says. */
export const resendInvitation = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ResendInvitationInput,
): Promise<Result<InvitationToSend, ResendInvitationRefusal>> => {
  const admitted = admit(resendInvitationAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const invitationId = INVITATION_ID.safeParse(input.invitationId);
  if (!invitationId.success) return err("malformed");

  const renewed = await oneWaiting(() =>
    tx.query(
      `UPDATE invitation SET expires_at = $3
        WHERE workspace_id = $1 AND id = $2 AND status = $4
       RETURNING ${RETURNED}`,
      [
        admitted.value.workspaceId,
        invitationId.data,
        expiryFrom(input.now),
        INVITATION_WAITING_STATUS,
      ],
    ),
  );
  if (!renewed.ok) return err(renewed.error);
  if (renewed.value === undefined) return err("no-such-invitation");

  await record(admitted.value, tx, {
    id: ulid(),
    act: INVITATION_ACTS.resent,
    subjectId: invitationId.data,
    detail: {},
  });
  return toSend(admitted.value, tx, renewed.value);
};

export type CancelInvitationInput = z.output<typeof invitationInput>;

export const cancelInvitation = async (
  principal: UserPrincipal,
  tx: Tx,
  input: CancelInvitationInput,
): Promise<Result<{ readonly invitationId: string }, CancelInvitationRefusal>> => {
  const admitted = admit(cancelInvitationAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const invitationId = INVITATION_ID.safeParse(input.invitationId);
  if (!invitationId.success) return err("malformed");

  const cancelled = await attempt(() =>
    tx.query(
      `UPDATE invitation SET status = $3
        WHERE workspace_id = $1 AND id = $2 AND status = $4`,
      [
        admitted.value.workspaceId,
        invitationId.data,
        INVITATION_CANCELLED_STATUS,
        INVITATION_WAITING_STATUS,
      ],
    ),
  );
  if (!cancelled.ok) return err(cancelled.error);
  if (cancelled.value.rowCount !== 1) return err("no-such-invitation");

  await record(admitted.value, tx, {
    id: ulid(),
    act: INVITATION_ACTS.cancelled,
    subjectId: invitationId.data,
    detail: {},
  });
  return ok({ invitationId: invitationId.data });
};

/**
 * Newest first. A lapsed invitation is listed with the waiting ones, since resending it is how an
 * Admin revives it.
 */
export const listInvitations = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly WaitingInvitation[], ListInvitationsRefusal>> => {
  const admitted = admit(listInvitationsAct, principal, {});
  if (!admitted.ok) return err(admitted.error);

  const listed = await attempt(async () =>
    z.array(LISTED_ROW).parse(
      (
        await tx.query(
          `SELECT ${RETURNED} FROM invitation
            WHERE workspace_id = $1 AND status = $2
            ORDER BY created_at DESC, id DESC`,
          [admitted.value.workspaceId, INVITATION_WAITING_STATUS],
        )
      ).rows,
    ),
  );
  if (!listed.ok) return err(listed.error);
  return ok(listed.value.map(waitingOf));
};
