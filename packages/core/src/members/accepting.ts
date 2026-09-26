import {
  boundarySchemas,
  INVITATION_ACCEPTED_STATUS,
  INVITATION_WAITING_STATUS,
} from "@better-answers/schema";
import { z } from "zod";

import { act, declareActs, recordFor } from "../audit/index.ts";
import {
  actorIdOfPerson,
  attempt,
  err,
  ok,
  refusalFor,
  type PlatformPrincipal,
  type Result,
  type Role,
  type UserId,
  type WorkspaceId,
  ulid,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityRead,
  withScope,
} from "../store/postgres/index.ts";
import { hasNoDisplayName, type WORKSPACE_REFUSALS } from "../workspaces/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const JOINING_ACTS = declareActs("people", {
  joined: act("people.member.joined", { invitationId: "id", role: "role" }),
});

/** Borrowed from the workspaces slice, whose words they are: adding a member refuses them too. */
type Borrowed = Extract<
  keyof typeof WORKSPACE_REFUSALS,
  "already-a-member" | "no-display-name" | "person-gone"
>;

export type AcceptInvitationRefusal =
  | MemberRefusal<
      "malformed" | "no-such-invitation" | "invitation-expired" | "invitation-for-another-address"
    >
  | Borrowed;

const INVITATION_ID = boundarySchemas.invitation.select.shape.id;

type InvitationId = z.output<typeof INVITATION_ID>;

const HELD_INVITATION = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  address: boundarySchemas.invitation.select.shape.email,
  role: boundarySchemas.member.select.shape.role,
  status: boundarySchemas.invitation.select.shape.status,
  expiresAt: boundarySchemas.invitation.select.shape.expiresAt,
  workspaceName: boundarySchemas.workspace.select.shape.name,
  invitedBy: boundarySchemas.user.select.shape.name,
});

type HeldInvitation = z.output<typeof HELD_INVITATION>;

const INVITEE = z.object({
  address: boundarySchemas.user.select.shape.email,
  emailVerified: boundarySchemas.user.select.shape.emailVerified,
  name: boundarySchemas.user.select.shape.name,
  alreadyAMember: z.boolean(),
});

type Invitee = z.output<typeof INVITEE>;

type Held = { readonly invitation: HeldInvitation; readonly invitee: Invitee };

type Asked = { readonly invitationId: InvitationId; readonly personId: UserId; readonly now: Date };

const HOLDING = {
  read: "",
  lock: "FOR UPDATE OF i",
} as const;

const invitationHeld = async (
  tx: Tx,
  invitationId: InvitationId,
  holding: keyof typeof HOLDING,
): Promise<HeldInvitation | undefined> => {
  const found = await tx.query(
    `SELECT i.workspace_id AS "workspaceId", i.email AS address, i.role, i.status,
            i.expires_at AS "expiresAt", w.name AS "workspaceName", inviter.name AS "invitedBy"
       FROM invitation i
       JOIN workspace w ON w.id = i.workspace_id
       JOIN "user" inviter ON inviter.id = i.inviter_id
      WHERE i.id = $1
      ${HOLDING[holding]}`,
    [invitationId],
  );
  const [row] = found.rows;
  return row === undefined ? undefined : HELD_INVITATION.parse(row);
};

const inviteeOf = async (
  tx: Tx,
  personId: UserId,
  workspaceId: WorkspaceId,
): Promise<Invitee | undefined> => {
  const found = await tx.query(
    `SELECT u.email AS address, u.email_verified AS "emailVerified", u.name,
            EXISTS (SELECT 1 FROM member m WHERE m.workspace_id = $2 AND m.user_id = u.id)
              AS "alreadyAMember"
       FROM "user" u WHERE u.id = $1`,
    [personId, workspaceId],
  );
  const [row] = found.rows;
  return row === undefined ? undefined : INVITEE.parse(row);
};

/**
 * The address is judged first, so a person holding another's link learns nothing of the
 * invitation's state.
 */
const refusalOf = (
  { invitation, invitee }: Held,
  now: Date,
): AcceptInvitationRefusal | undefined => {
  const invited = invitation.address.toLowerCase() === invitee.address.toLowerCase();
  if (!invitee.emailVerified || !invited) return "invitation-for-another-address";
  if (invitee.alreadyAMember) return "already-a-member";
  if (invitation.status !== INVITATION_WAITING_STATUS) return "no-such-invitation";
  if (invitation.expiresAt <= now) return "invitation-expired";
  if (hasNoDisplayName(invitee.name)) return "no-display-name";
  return undefined;
};

const judged = async (
  tx: Tx,
  asked: Asked,
  holding: keyof typeof HOLDING,
): Promise<Result<Held, AcceptInvitationRefusal>> => {
  const invitation = await invitationHeld(tx, asked.invitationId, holding);
  if (invitation === undefined) return err("no-such-invitation");
  const invitee = await inviteeOf(tx, asked.personId, invitation.workspaceId);
  if (invitee === undefined) return err("person-gone");
  const refused = refusalOf({ invitation, invitee }, asked.now);
  return refused === undefined ? ok({ invitation, invitee }) : err(refused);
};

export type ReadInvitationInput = {
  readonly invitationId: string;

  /** The session's own person, never one the request names. */
  readonly personId: string;
  readonly now: Date;
};

// An id that parses as none names no invitation, which is what a mistyped link is.
const askedOf = (
  input: ReadInvitationInput,
): Result<Asked, MemberRefusal<"malformed" | "no-such-invitation">> => {
  const invitationId = INVITATION_ID.safeParse(input.invitationId);
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");
  if (!invitationId.success) return err("no-such-invitation");
  return ok({ invitationId: invitationId.data, personId: personId.data, now: input.now });
};

export type InvitationRead = {
  readonly invitationId: string;
  readonly workspaceName: string;
  readonly role: Role;

  /** By display name, read from the inviter's person row, so it stands after they leave. */
  readonly invitedBy: string;
  readonly expiresAt: string;
};

/**
 * What accepting would join, for the person the invitation is addressed to; it refuses as
 * accepting would, so the page says so before the click.
 */
export const readInvitation = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ReadInvitationInput,
): Promise<Result<InvitationRead, AcceptInvitationRefusal | Error>> => {
  const asked = askedOf(input);
  if (!asked.ok) return err(asked.error);

  const read = await attempt(() =>
    withIdentityRead(platform, door, (tx) => judged(tx, asked.value, "read")),
  );
  if (!read.ok) return err(read.error);
  if (!read.value.ok) return err(read.value.error);
  const { invitation } = read.value.value;
  return ok({
    invitationId: asked.value.invitationId,
    workspaceName: invitation.workspaceName,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
    expiresAt: invitation.expiresAt.toISOString(),
  });
};

const workspaceOfInvitation = (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  invitationId: InvitationId,
): Promise<Result<WorkspaceId | undefined, Error>> =>
  attempt(() =>
    withIdentityRead(platform, door, async (tx) => {
      const found = await tx.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM invitation WHERE id = $1",
        [invitationId],
      );
      const id = found.rows[0]?.workspace_id;
      return id === undefined ? undefined : boundarySchemas.workspace.select.shape.id.parse(id);
    }),
  );

export type Joined = {
  readonly workspaceId: WorkspaceId;
  readonly workspaceName: string;
  readonly role: Role;
};

type Joining = Asked & { readonly sessionId: string };

const join = async (
  platform: PlatformPrincipal,
  tx: Tx,
  joining: Joining,
): Promise<Result<Joined, AcceptInvitationRefusal>> => {
  // The invitation's row lock queues a second accept of it, which then finds the member.
  const held = await judged(tx, joining, "lock");
  if (!held.ok) return held;
  const { workspaceId, workspaceName, role } = held.value.invitation;

  await tx.query("UPDATE invitation SET status = $2 WHERE id = $1", [
    joining.invitationId,
    INVITATION_ACCEPTED_STATUS,
  ]);
  await tx.query(
    "INSERT INTO member (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())",
    [ulid(), workspaceId, joining.personId, role],
  );
  await tx.query(
    `UPDATE session SET active_workspace_id = $1, updated_at = now()
      WHERE id = $2 AND user_id = $3`,
    [workspaceId, joining.sessionId, joining.personId],
  );
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(joining.personId),
    act: JOINING_ACTS.joined,
    subjectId: joining.personId,
    detail: { invitationId: joining.invitationId, role },
  });
  return ok({ workspaceId, workspaceName, role });
};

const JOIN_CONSTRAINTS = {
  member_workspace_id_user_id_uidx: "already-a-member",
} as const satisfies Record<string, AcceptInvitationRefusal>;

export type AcceptInvitationInput = ReadInvitationInput & {
  /** The session the request came on, which the joined workspace becomes the active one of. */
  readonly sessionId: string;
};

/**
 * Makes the invited person a member at the invitation's role, points their session at the
 * workspace and records `people.member.joined` as theirs, all in one transaction.
 */
export const acceptInvitation = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: AcceptInvitationInput,
): Promise<Result<Joined, AcceptInvitationRefusal | Error>> => {
  const asked = askedOf(input);
  if (!asked.ok) return err(asked.error);
  const sessionId = boundarySchemas.session.select.shape.id.safeParse(input.sessionId);
  if (!sessionId.success) return err("malformed");

  const workspace = await workspaceOfInvitation(platform, door, asked.value.invitationId);
  if (!workspace.ok) return err(workspace.error);
  const workspaceId = workspace.value;
  if (workspaceId === undefined) return err("no-such-invitation");

  const joined = await attempt(() =>
    withScope(platform, door, workspaceId, (tx) =>
      join(platform, tx, { ...asked.value, sessionId: sessionId.data }),
    ),
  );
  if (!joined.ok) return err(refusalFor(joined.error, JOIN_CONSTRAINTS));
  return joined.value;
};
