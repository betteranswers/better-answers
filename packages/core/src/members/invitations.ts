import { createHash } from "node:crypto";

import { z } from "zod";

import {
  boundarySchemas,
  INVITATION_ACCEPTED_STATUS,
  INVITATION_CANCELLED_STATUS,
  INVITATION_EXPIRY_SECONDS,
  INVITATION_WAITING_STATUS,
} from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { act, batchIdFor, declareActs, record, recordEach } from "../audit/index.ts";
import {
  admit,
  attempt,
  CeilingMet,
  declareAct,
  emailAddressOf,
  err,
  ok,
  type AdminUserPrincipal,
  type KernelRefusal,
  type RefusalOf,
  type RefusedItems,
  type Result,
  type Role,
  type UserPrincipal,
  ulid,
} from "../kernel/index.ts";
import {
  consumeIngressIn,
  refusalOfDeadlock,
  type CounterRule,
  type Tx,
} from "../store/postgres/index.ts";
import type { WORKSPACE_REFUSALS } from "../workspaces/index.ts";
import {
  distinct,
  namedEach,
  notAmong,
  outcomeOf,
  refusedItemsOf,
  type BulkOutcome,
} from "./sets.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const INVITATION_ACTS = declareActs("people", {
  created: act("people.invitation.created", { role: "role" }),
  resent: act("people.invitation.resent", {}),
  cancelled: act("people.invitation.cancelled", { replacedByInvitationId: "id?" }),
});

/** One workspace emails an address at most this often, by an invite or a resend alike. */
const INVITATION_CEILING: CounterRule = { windowMs: 60 * 60_000, max: 5 };

/** One act sends to, or holds, at most this many invitations until it commits. */
const MOST_AT_ONCE = 50;

const ROLE = boundarySchemas.member.select.shape.role;

const INVITATION_ID = boundarySchemas.invitation.select.shape.id;

const ADMIN_ALONE = { role: "Admin", purposes: [] } as const;

const NO_SUCH_INVITATION = "no-such-invitation" satisfies MemberRefusal<"no-such-invitation">;

/** An address any case spells, or none, reaches the act, which names each it refuses. */
export const inviteMembersInput = z.object({
  addresses: z.array(z.string()).min(1).max(MOST_AT_ONCE),
  role: z.string(),
});

const inviteMembersAct = declareAct({
  admits: ADMIN_ALONE,
  input: inviteMembersInput,
  refuses: ["role-forbids", "no-such-role", "malformed", "already-a-member", "changed-meanwhile"],
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

/** Borrowed from the workspaces slice, whose word it is: joining refuses a member in it too. */
type AlreadyAMember = Extract<keyof typeof WORKSPACE_REFUSALS, "already-a-member">;

export type InviteMembersRefusal =
  | MemberRefusal<"role-forbids" | "no-such-role" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"malformed"> | AlreadyAMember>
  | Error;

export type ResendInvitationRefusal = MemberRefusal<RefusalOf<typeof resendInvitationAct>> | Error;

export type CancelInvitationRefusal = MemberRefusal<RefusalOf<typeof cancelInvitationAct>> | Error;

type SetRefusal =
  | MemberRefusal<"role-forbids">
  | KernelRefusal<"changed-meanwhile">
  | RefusedItems<MemberRefusal<"no-such-invitation">>
  | Error;

export type BulkResendInvitationsRefusal = SetRefusal;

export type BulkCancelInvitationsRefusal = SetRefusal;

export type ListInvitationsRefusal =
  | MemberRefusal<RefusalOf<typeof listInvitationsAct | typeof countInvitationsAct>>
  | Error;

const WAITING_ROW = z.object({
  invitationId: INVITATION_ID,
  address: boundarySchemas.invitation.select.shape.email,
  role: ROLE,
  invitedAt: boundarySchemas.invitation.select.shape.createdAt,
  expiresAt: boundarySchemas.invitation.select.shape.expiresAt,
});

type WaitingRow = z.output<typeof WAITING_ROW>;

/** The instants are ISO strings, which is what a `Date` becomes on the wire anyway. */
type WaitingInvitation = Omit<WaitingRow, "invitedAt" | "expiresAt"> & {
  readonly invitedAt: string;
  readonly expiresAt: string;
};

/** The inviter by display name, read from their person row, so it stands after they leave. */
export type ListedInvitation = WaitingInvitation & {
  readonly invitedBy: string;
  readonly status: InvitationStatus;
};

const LISTED_ROW = WAITING_ROW.extend({
  invitedBy: boundarySchemas.user.select.shape.name,
  status: z.enum(INVITATION_STATUSES),
});

/** What the email to the invited address is written from. */
export type InvitationToSend = WaitingInvitation & { readonly workspaceName: string };

/** Each invitation a send minted, and whether it replaced the one waiting for its address. */
export type InvitationMinted = InvitationToSend & { readonly replaced: boolean };

export type InvitationCounts = Readonly<Record<InvitationStatus, number>>;

const RETURNED = `id AS "invitationId", email AS address, role, created_at AS "invitedAt",
                  expires_at AS "expiresAt"`;

const waitingOf = <Row extends WaitingRow>(
  row: Row,
): Omit<Row, "invitedAt" | "expiresAt"> & { invitedAt: string; expiresAt: string } => ({
  ...row,
  invitedAt: row.invitedAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

const WORKSPACE_NAMED = z.object({ name: boundarySchemas.workspace.select.shape.name });

const expiryFrom = (now: Date): Date => new Date(now.getTime() + INVITATION_EXPIRY_SECONDS * 1000);

/** The admitted Admin's own workspace, so a row the parse finds missing is a failure. */
const workspaceNameOf = async (admin: AdminUserPrincipal, tx: Tx): Promise<string> =>
  WORKSPACE_NAMED.parse(
    (await tx.query("SELECT name FROM workspace WHERE id = $1", [admin.workspaceId])).rows[0],
  ).name;

/** Hashed, so no address is kept as a counter's key. */
const counterKeyOf = (admin: AdminUserPrincipal, address: string): string =>
  createHash("sha256").update(`${admin.workspaceId}:${address}`).digest("hex");

/** In key order, so two acts counting one address queue rather than deadlock; past the ceiling the act fails whole. */
const emailsCounted = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  addresses: readonly string[],
  now: Date,
): Promise<Result<undefined, CeilingMet>> => {
  const keys = addresses.map((address) => counterKeyOf(admin, address)).toSorted(byCodeUnit);
  for (const key of keys) {
    const counted = await consumeIngressIn(tx, "invitation", key, INVITATION_CEILING, now);
    if (!counted.allowed) return err(new CeilingMet(counted.retryAfterSeconds));
  }
  return ok(undefined);
};

type Minting = {
  readonly invitations: readonly { readonly invitationId: string; readonly address: string }[];
  readonly role: Role;
  readonly now: Date;
};

/** Two sends naming one address queue here, so the later replaces the earlier's invitation. */
const ADDRESS_LOCK =
  "SELECT pg_advisory_xact_lock(hashtext('invitation'), hashtext($1 || ' ' || $2))";

const HELD_WAITING_FOR = `SELECT id FROM invitation
                           WHERE workspace_id = $1 AND lower(email) = ANY($2::text[]) AND status = $3
                           ORDER BY id FOR UPDATE`;

const CANCELLED_AMONG = `UPDATE invitation SET status = $3
                          WHERE workspace_id = $1 AND id = ANY($2::text[])
                         RETURNING id, lower(email) AS address`;

const MINTED = `INSERT INTO invitation (id, workspace_id, email, role, status, created_at, expires_at, inviter_id)
                SELECT minted.id, $1, minted.address, $4, $5, $6, $7, $8
                  FROM unnest($2::text[], $3::text[]) AS minted(id, address)`;

/** Answers the id of each waiting invitation it cancelled, by its address. */
const waitingCancelled = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  addresses: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  for (const address of addresses.toSorted(byCodeUnit)) {
    await tx.query(ADDRESS_LOCK, [admin.workspaceId, address]);
  }
  const held = await tx.query<{ id: string }>(HELD_WAITING_FOR, [
    admin.workspaceId,
    addresses,
    INVITATION_WAITING_STATUS,
  ]);
  const cancelled = await tx.query<{ id: string; address: string }>(CANCELLED_AMONG, [
    admin.workspaceId,
    held.rows.map((row) => row.id),
    INVITATION_CANCELLED_STATUS,
  ]);
  return new Map(cancelled.rows.map((row) => [row.address, row.id]));
};

const mintsRecorded = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  minting: Minting,
  replaced: ReadonlyMap<string, string>,
): Promise<void> => {
  const batchId = batchIdFor(minting.invitations.length + replaced.size);
  for (const { invitationId, address } of minting.invitations) {
    const detail = { role: minting.role };
    await record(admin, tx, {
      id: ulid(),
      act: INVITATION_ACTS.created,
      subjectId: invitationId,
      detail,
      batchId,
    });
    const cancelledId = replaced.get(address);
    if (cancelledId === undefined) continue;
    await record(admin, tx, {
      id: ulid(),
      act: INVITATION_ACTS.cancelled,
      subjectId: cancelledId,
      detail: { replacedByInvitationId: invitationId },
      batchId,
    });
  }
};

type Minted = {
  /** Each address whose waiting invitation the mint replaced. */
  readonly replaced: ReadonlySet<string>;

  readonly workspaceName: string;
};

/**
 * Mints each invitation, cancelling the one waiting for its address, with their events in one
 * batch, and answers what the emails need beside the invitations.
 */
const mintedEach = async (admin: AdminUserPrincipal, tx: Tx, minting: Minting): Promise<Minted> => {
  const addresses = minting.invitations.map((one) => one.address);
  const replaced = await waitingCancelled(admin, tx, addresses);
  await tx.query(MINTED, [
    admin.workspaceId,
    minting.invitations.map((one) => one.invitationId),
    addresses,
    minting.role,
    INVITATION_WAITING_STATUS,
    minting.now,
    expiryFrom(minting.now),
    admin.userId,
  ]);
  await mintsRecorded(admin, tx, minting, replaced);
  return { replaced: new Set(replaced.keys()), workspaceName: await workspaceNameOf(admin, tx) };
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
 * link stands, and writes `people.invitation.created`, with the replaced one's cancellation beside
 * it in one batch.
 */
export const mintInvitation = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  input: MintInvitationInput,
): Promise<Result<InvitationToSend, Error>> => {
  const address = input.address.toLowerCase();
  const invitationId = ulid();
  const { role, now } = input;

  const minted = await attempt(() =>
    mintedEach(admin, tx, { invitations: [{ invitationId, address }], role, now }),
  );
  if (!minted.ok) return err(minted.error);
  return ok({
    invitationId,
    address,
    role,
    invitedAt: now.toISOString(),
    expiresAt: expiryFrom(now).toISOString(),
    workspaceName: minted.value.workspaceName,
  });
};

const MEMBERS_AMONG = `SELECT lower(u.email) AS address FROM member m JOIN "user" u ON u.id = m.user_id
                        WHERE m.workspace_id = $1 AND lower(u.email) = ANY($2::text[])`;

/** Each position in the send whose address `belongs`, as the key a refused item takes. */
const positionsWhere = (
  addresses: readonly string[],
  belongs: (address: string) => boolean,
): readonly string[] =>
  addresses.flatMap((address, position) => (belongs(address) ? [String(position)] : []));

type Parsed = { readonly addresses: readonly string[]; readonly malformed: readonly string[] };

/** Each address as the mint keys it, and the position of each that is none. */
const addressesOf = (asked: readonly string[]): Parsed =>
  asked.reduce<Parsed>(
    (parsed, raw, position) => {
      const address = emailAddressOf(raw);
      return address === undefined
        ? { ...parsed, malformed: [...parsed.malformed, String(position)] }
        : { ...parsed, addresses: [...parsed.addresses, address] };
    },
    { addresses: [], malformed: [] },
  );

type Sending = { readonly addresses: readonly string[]; readonly role: Role; readonly now: Date };

/** Counts each address's email, then refuses the members among them, then mints. */
const sentUnderLocks = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  sending: Sending,
): Promise<Result<readonly InvitationMinted[], RefusedItems<AlreadyAMember> | CeilingMet>> => {
  const addresses = distinct(sending.addresses);
  const counted = await emailsCounted(admin, tx, addresses, sending.now);
  if (!counted.ok) return err(counted.error);

  const members = await tx.query<{ address: string }>(MEMBERS_AMONG, [
    admin.workspaceId,
    addresses,
  ]);
  const memberAddresses = new Set(members.rows.map((row) => row.address));
  const refused = refusedItemsOf(
    namedEach(
      positionsWhere(sending.addresses, (address) => memberAddresses.has(address)),
      "already-a-member" satisfies AlreadyAMember,
    ),
  );
  if (refused !== undefined) return err(refused);

  const minting = {
    ...sending,
    invitations: addresses.map((address) => ({ invitationId: ulid(), address })),
  };
  const { replaced, workspaceName } = await mintedEach(admin, tx, minting);
  const sent = {
    role: sending.role,
    invitedAt: sending.now.toISOString(),
    expiresAt: expiryFrom(sending.now).toISOString(),
    workspaceName,
  };
  return ok(
    minting.invitations.map(({ invitationId, address }) => ({
      ...sent,
      invitationId,
      address,
      replaced: replaced.has(address),
    })),
  );
};

export type InviteMembersInput = z.output<typeof inviteMembersInput> & { readonly now: Date };

/**
 * One invitation per address, folded however it is cased, or none: an address of no known form,
 * or one a member here holds, refuses the send naming each by its position. A waiting invitation
 * to an address is replaced, and the answer says so.
 */
export const inviteMembers = async (
  principal: UserPrincipal,
  tx: Tx,
  input: InviteMembersInput,
): Promise<Result<readonly InvitationMinted[], InviteMembersRefusal>> => {
  const admitted = admit(inviteMembersAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const role = ROLE.safeParse(input.role);
  if (!role.success) return err("no-such-role");

  const { addresses, malformed } = addressesOf(input.addresses);
  const refused = refusedItemsOf(
    namedEach(malformed, "malformed" satisfies MemberRefusal<"malformed">),
  );
  if (refused !== undefined) return err(refused);

  const sending = { addresses, role: role.data, now: input.now };
  const done = await attempt(() => sentUnderLocks(admitted.value, tx, sending));
  return done.ok ? done.value : err(refusalOfDeadlock(done.error));
};

export type ResendInvitationInput = z.output<typeof invitationInput> & { readonly now: Date };

const ADDRESSES_WAITING = `SELECT lower(email) AS address FROM invitation
                            WHERE workspace_id = $1 AND id = ANY($2::text[]) AND status = $3`;

/** Read unlocked, so every act takes its counters before any invitation row it holds. */
const waitingCounted = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  invitationIds: readonly string[],
  now: Date,
): Promise<Result<undefined, CeilingMet>> => {
  const waiting = await tx.query<{ address: string }>(ADDRESSES_WAITING, [
    admin.workspaceId,
    invitationIds,
    INVITATION_WAITING_STATUS,
  ]);
  return emailsCounted(
    admin,
    tx,
    waiting.rows.map((row) => row.address),
    now,
  );
};

/** The parse brands the ids; a row it throws on fails the act like the query would. */
const firstWaitingOf = (rows: readonly unknown[]): WaitingInvitation | undefined => {
  const [row] = rows;
  return row === undefined ? undefined : waitingOf(WAITING_ROW.parse(row));
};

const RENEWED_ONE = `UPDATE invitation SET expires_at = $3
                      WHERE workspace_id = $1 AND id = $2 AND status = $4
                     RETURNING ${RETURNED}`;

const renewedOne = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  input: ResendInvitationInput,
): Promise<Result<InvitationToSend, MemberRefusal<"no-such-invitation"> | CeilingMet>> => {
  const counted = await waitingCounted(admin, tx, [input.invitationId], input.now);
  if (!counted.ok) return err(counted.error);
  const renewed = firstWaitingOf(
    (
      await tx.query(RENEWED_ONE, [
        admin.workspaceId,
        input.invitationId,
        expiryFrom(input.now),
        INVITATION_WAITING_STATUS,
      ])
    ).rows,
  );
  if (renewed === undefined) return err(NO_SUCH_INVITATION);

  await record(admin, tx, {
    id: ulid(),
    act: INVITATION_ACTS.resent,
    subjectId: renewed.invitationId,
    detail: {},
  });
  return ok({ ...renewed, workspaceName: await workspaceNameOf(admin, tx) });
};

/**
 * A resent invitation keeps its link and runs seven days from `now`, as the new email says. Each
 * resend counts against the address's ceiling.
 */
export const resendInvitation = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ResendInvitationInput,
): Promise<Result<InvitationToSend, ResendInvitationRefusal>> => {
  const admitted = admit(resendInvitationAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const invitationId = INVITATION_ID.safeParse(input.invitationId);
  if (!invitationId.success) return err("malformed");

  const renewed = await attempt(() =>
    renewedOne(admitted.value, tx, { invitationId: invitationId.data, now: input.now }),
  );
  return renewed.ok ? renewed.value : err(renewed.error);
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
  if (cancelled.value.rowCount !== 1) return err(NO_SUCH_INVITATION);

  await record(admitted.value, tx, {
    id: ulid(),
    act: INVITATION_ACTS.cancelled,
    subjectId: invitationId.data,
    detail: {},
  });
  return ok({ invitationId: invitationId.data });
};

/** One statement, in id order, so two acts holding overlapping sets take them alike. */
const HELD_INVITATIONS = `SELECT id, status FROM invitation
                           WHERE workspace_id = $1 AND id = ANY($2::text[])
                           ORDER BY id FOR UPDATE`;

type HeldInvitation = { readonly invitationId: string; readonly status: string };

/** Each id asked for and held here in none of `standing`, named `no-such-invitation`. */
const refusedOutside = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  invitationIds: readonly string[],
  standing: readonly string[],
): Promise<{
  readonly held: readonly HeldInvitation[];
  readonly refused: RefusedItems<MemberRefusal<"no-such-invitation">> | undefined;
}> => {
  const rows = await tx.query<{ id: string; status: string }>(HELD_INVITATIONS, [
    admin.workspaceId,
    invitationIds,
  ]);
  const held = rows.rows.map((row) => ({ invitationId: row.id, status: row.status }));
  const found = held.filter((row) => standing.includes(row.status)).map((row) => row.invitationId);
  return {
    held,
    refused: refusedItemsOf(namedEach(notAmong(invitationIds, found), NO_SUCH_INVITATION)),
  };
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
  const { refused } = await refusedOutside(admin, tx, invitationIds, [INVITATION_WAITING_STATUS]);
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
 * here refuses the set naming each. Past an address's ceiling, the set fails whole.
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
  const { refused } = await refusedOutside(admin, tx, invitationIds, [
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
