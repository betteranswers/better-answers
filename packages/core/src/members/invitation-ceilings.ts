import { createHash } from "node:crypto";

import { INVITATION_WAITING_STATUS } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import {
  CeilingMet,
  err,
  ok,
  type AdminUserPrincipal,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  consumeInvitationEmails,
  returnInvitationEmails,
  type CounterRule,
  type Tx,
} from "../store/postgres/index.ts";

const INVITATION_CEILING: CounterRule = { windowMs: 60 * 60_000, max: 5 };

/** Every workspace mails through one shared account, which a flood could get suspended; a few hundred people still fit in two hours. */
const WORKSPACE_INVITATION_CEILING: CounterRule = { windowMs: 60 * 60_000, max: 200 };

const counterKeyOf = (admin: UserPrincipal, address: string): string =>
  createHash("sha256").update(`${admin.workspaceId}:${address}`).digest("hex");

const WORKSPACE_KEY = "workspace";

type Counter = { readonly key: string; readonly rule: CounterRule; readonly amount: number };

const countersOf = (admin: UserPrincipal, addresses: readonly string[]): readonly Counter[] =>
  [
    ...addresses.map((address) => ({
      key: counterKeyOf(admin, address),
      rule: INVITATION_CEILING,
      amount: 1,
    })),
    { key: WORKSPACE_KEY, rule: WORKSPACE_INVITATION_CEILING, amount: addresses.length },
  ].toSorted((one, other) => byCodeUnit(one.key, other.key));

export type Counted<Invitation> = Invitation & { readonly countedAt: Date };

export const emailsCounted = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  addresses: readonly string[],
  now: Date,
): Promise<Result<undefined, CeilingMet>> => {
  for (const { key, rule, amount } of countersOf(admin, addresses)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- counting stops at the first ceiling met, so later counters stay unspent
    const counted = await consumeInvitationEmails(admin, tx, key, rule, now, amount);
    if (!counted.allowed) return err(new CeilingMet(counted.retryAfterSeconds));
  }
  return ok(undefined);
};

const ADDRESSES_WAITING = `SELECT lower(email) AS address FROM invitation
                            WHERE workspace_id = $1 AND id = ANY($2::text[]) AND status = $3`;

export const waitingCounted = async (
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

const ADDRESSES_OF = `SELECT lower(email) AS address FROM invitation
                       WHERE workspace_id = $1 AND id = ANY($2::text[])`;

/** Gives each unsent email's count back to the window it was counted in, never below zero. */
export const returnUnsentEmails = async (
  principal: UserPrincipal,
  tx: Tx,
  unsent: readonly Counted<{ readonly invitationId: string }>[],
): Promise<void> => {
  const windows = Map.groupBy(unsent, (invitation) => invitation.countedAt.getTime());
  for (const [countedAtMs, invitations] of windows) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- every address read runs on the caller's transaction
    const addresses = await tx.query<{ address: string }>(ADDRESSES_OF, [
      principal.workspaceId,
      invitations.map((invitation) => invitation.invitationId),
    ]);
    const counters = countersOf(
      principal,
      addresses.rows.map((row) => row.address),
    );
    for (const { key, rule, amount } of counters) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- every counter returned runs on the caller's transaction
      await returnInvitationEmails(principal, tx, key, rule, new Date(countedAtMs), amount);
    }
  }
};
