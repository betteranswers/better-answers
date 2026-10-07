import { z } from "zod";

import {
  boundarySchemas,
  INVITATION_CANCELLED_STATUS,
  INVITATION_EXPIRY_SECONDS,
  INVITATION_WAITING_STATUS,
} from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { action, batchIdFor, declareActions, record } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAction,
  emailAddressOf,
  err,
  ok,
  type AdminUserPrincipal,
  type CeilingMet,
  type RefusalOf,
  type RefusedItems,
  type Result,
  type Role,
  type UserPrincipal,
  ulid,
} from "../kernel/index.ts";
import { refusalOfDeadlock, type Tx } from "../store/postgres/index.ts";
import type { WORKSPACE_REFUSALS } from "../workspaces/index.ts";
import { emailsCounted, waitingCounted } from "./invitation-ceilings.ts";
import { distinct, namedEach, refusedItemsOf } from "./sets.ts";
import {
  invitationsOffDomain,
  isOffDomain,
  OFF_TESTING_DOMAIN,
  testingDomainOf,
} from "./testing-domain.ts";
import type { MemberRefusal } from "./vocabulary.ts";

export const INVITATION_ACTIONS = declareActions("people", {
  created: action("people.invitation.created", { role: "role" }),
  resent: action("people.invitation.resent", {}),
  cancelled: action("people.invitation.cancelled", { replacedByInvitationId: "id?" }),
});

/** One action sends to, or holds, at most this many invitations until it commits. */
export const MOST_AT_ONCE = 50;

const ROLE = boundarySchemas.member.select.shape.role;

export const INVITATION_ID = boundarySchemas.invitation.select.shape.id;

export const ADMIN_ALONE = { role: "Admin", purposes: [] } as const;

export const NO_SUCH_INVITATION =
  "no-such-invitation" satisfies MemberRefusal<"no-such-invitation">;

/** An address any case spells, or none, reaches the action, which names each it refuses. */
export const inviteMembersInput = z.object({
  addresses: z.array(z.string()).min(1).max(MOST_AT_ONCE),
  role: z.string(),
});

const inviteMembersAction = declareAction({
  admits: ADMIN_ALONE,
  input: inviteMembersInput,
  refuses: [
    "role-forbids",
    "no-such-role",
    "malformed",
    "already-a-member",
    "off-testing-domain",
    "changed-meanwhile",
  ],
  effect: "write",
});

export const invitationInput = z.object({ invitationId: z.string() });

type OnAnInvitationRefusal = MemberRefusal<"role-forbids" | "malformed" | "no-such-invitation">;

const ON_AN_INVITATION: readonly OnAnInvitationRefusal[] = [
  "role-forbids",
  "malformed",
  "no-such-invitation",
];

const resendInvitationAction = declareAction({
  admits: ADMIN_ALONE,
  input: invitationInput,
  refuses: [...ON_AN_INVITATION, OFF_TESTING_DOMAIN],
  effect: "write",
});

const cancelInvitationAction = declareAction({
  admits: ADMIN_ALONE,
  input: invitationInput,
  refuses: ON_AN_INVITATION,
  effect: "write",
});

/** Borrowed from the workspaces slice, whose word it is: joining refuses a member in it too. */
type AlreadyAMember = Extract<keyof typeof WORKSPACE_REFUSALS, "already-a-member">;

export type InviteMembersRefusal =
  | MemberRefusal<"role-forbids" | "no-such-role" | "changed-meanwhile">
  | RefusedItems<MemberRefusal<"malformed" | "off-testing-domain"> | AlreadyAMember>
  | Error;

export type ResendInvitationRefusal =
  | MemberRefusal<RefusalOf<typeof resendInvitationAction>>
  | Error;

export type CancelInvitationRefusal =
  | MemberRefusal<RefusalOf<typeof cancelInvitationAction>>
  | Error;

export const WAITING_ROW = z.object({
  invitationId: INVITATION_ID,
  address: boundarySchemas.invitation.select.shape.email,
  role: ROLE,
  invitedAt: boundarySchemas.invitation.select.shape.createdAt,
  expiresAt: boundarySchemas.invitation.select.shape.expiresAt,
});

type WaitingRow = z.output<typeof WAITING_ROW>;

/** The instants are ISO strings, which is what a `Date` becomes on the wire anyway. */
export type WaitingInvitation = Omit<WaitingRow, "invitedAt" | "expiresAt"> & {
  readonly invitedAt: string;
  readonly expiresAt: string;
};

/** What the email to the invited address is written from. */
export type InvitationToSend = WaitingInvitation & { readonly workspaceName: string };

/** Each invitation a send minted, and whether it replaced the one waiting for its address. */
export type InvitationMinted = InvitationToSend & { readonly replaced: boolean };

export const RETURNED = `id AS "invitationId", email AS address, role, created_at AS "invitedAt",
                  expires_at AS "expiresAt"`;

export const waitingOf = <Row extends WaitingRow>(
  row: Row,
): Omit<Row, "invitedAt" | "expiresAt"> & { invitedAt: string; expiresAt: string } => ({
  ...row,
  invitedAt: row.invitedAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

const WORKSPACE_NAMED = z.object({ name: boundarySchemas.workspace.select.shape.name });

export const expiryFrom = (now: Date): Date =>
  new Date(now.getTime() + INVITATION_EXPIRY_SECONDS * 1000);

const windowOf = (now: Date): Pick<WaitingInvitation, "invitedAt" | "expiresAt"> => ({
  invitedAt: now.toISOString(),
  expiresAt: expiryFrom(now).toISOString(),
});

/** The admitted Admin's own workspace, so a row the parse finds missing is a failure. */
export const workspaceNameOf = async (admin: AdminUserPrincipal, tx: Tx): Promise<string> =>
  WORKSPACE_NAMED.parse(
    (await tx.query("SELECT name FROM workspace WHERE id = $1", [admin.workspaceId])).rows[0],
  ).name;

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
      action: INVITATION_ACTIONS.created,
      subjectId: invitationId,
      detail,
      batchId,
    });
    const cancelledId = replaced.get(address);
    if (cancelledId === undefined) continue;
    await record(admin, tx, {
      id: ulid(),
      action: INVITATION_ACTIONS.cancelled,
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
): Promise<Result<InvitationToSend, MemberRefusal<"off-testing-domain"> | Error>> => {
  const address = input.address.toLowerCase();
  const invitationId = ulid();
  const { role, now } = input;

  const domain = await attempt(() => testingDomainOf(admin, tx));
  if (!domain.ok) return err(domain.error);
  if (isOffDomain(domain.value, address)) return err(OFF_TESTING_DOMAIN);

  const minted = await attempt(() =>
    mintedEach(admin, tx, { invitations: [{ invitationId, address }], role, now }),
  );
  if (!minted.ok) return err(minted.error);
  return ok({
    invitationId,
    address,
    role,
    ...windowOf(now),
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

const offDomainRefused = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  addresses: readonly string[],
): Promise<RefusedItems<MemberRefusal<"off-testing-domain">> | undefined> => {
  const domain = await testingDomainOf(admin, tx);
  return refusedItemsOf(
    namedEach(
      positionsWhere(addresses, (address) => isOffDomain(domain, address)),
      OFF_TESTING_DOMAIN,
    ),
  );
};

type SendRefusal = RefusedItems<AlreadyAMember | MemberRefusal<"off-testing-domain">> | CeilingMet;

/** Refuses each address off a marked workspace's domain, counts every email, refuses members, mints. */
const sentUnderLocks = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  sending: Sending,
): Promise<Result<readonly InvitationMinted[], SendRefusal>> => {
  const offDomain = await offDomainRefused(admin, tx, sending.addresses);
  if (offDomain !== undefined) return err(offDomain);
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
  const sent = { role: sending.role, ...windowOf(sending.now), workspaceName };
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
 * off a marked workspace's testing domain, or a member's here refuses the send naming each by its
 * position. A waiting invitation to an address is replaced, and the answer says so.
 */
export const inviteMembers = async (
  principal: UserPrincipal,
  tx: Tx,
  input: InviteMembersInput,
): Promise<Result<readonly InvitationMinted[], InviteMembersRefusal>> => {
  const admitted = admit(inviteMembersAction, principal, input);
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

/** The parse brands the ids; a row it throws on fails the action like the query would. */
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
): Promise<
  Result<InvitationToSend, MemberRefusal<"no-such-invitation" | "off-testing-domain"> | CeilingMet>
> => {
  const offDomain = await invitationsOffDomain(admin, tx, [input.invitationId]);
  if (offDomain.length > 0) return err(OFF_TESTING_DOMAIN);
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
    action: INVITATION_ACTIONS.resent,
    subjectId: renewed.invitationId,
    detail: {},
  });
  return ok({ ...renewed, workspaceName: await workspaceNameOf(admin, tx) });
};

/**
 * A resent invitation keeps its link and runs seven days from `now`, as the new email says. Each
 * resend counts against the address's ceiling and the workspace's.
 */
export const resendInvitation = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ResendInvitationInput,
): Promise<Result<InvitationToSend, ResendInvitationRefusal>> => {
  const admitted = admit(resendInvitationAction, principal, input);
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
  const admitted = admit(cancelInvitationAction, principal, input);
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
    action: INVITATION_ACTIONS.cancelled,
    subjectId: invitationId.data,
    detail: {},
  });
  return ok({ invitationId: invitationId.data });
};
