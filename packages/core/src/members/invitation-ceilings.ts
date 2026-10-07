import { createHash } from "node:crypto";

import { INVITATION_WAITING_STATUS } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { CeilingMet, err, ok, type AdminUserPrincipal, type Result } from "../kernel/index.ts";
import { consumeInvitationEmails, type CounterRule, type Tx } from "../store/postgres/index.ts";

/** One workspace emails an address at most this often, by an invite or a resend alike. */
const INVITATION_CEILING: CounterRule = { windowMs: 60 * 60_000, max: 5 };

/** Every workspace mails through one shared account, which a flood could get suspended; a few hundred people still fit in two hours. */
const WORKSPACE_INVITATION_CEILING: CounterRule = { windowMs: 60 * 60_000, max: 200 };

/** Hashed, so no address is kept as a counter's key, and salted by the workspace, so no two workspaces share one. */
const counterKeyOf = (admin: AdminUserPrincipal, address: string): string =>
  createHash("sha256").update(`${admin.workspaceId}:${address}`).digest("hex");

/** No hex digest spells it, so it never meets an address's key, and every one sorts before it. */
const WORKSPACE_KEY = "workspace";

type Counter = { readonly key: string; readonly rule: CounterRule; readonly amount: number };

const countersOf = (
  admin: AdminUserPrincipal,
  addresses: readonly string[],
): readonly Counter[] => [
  ...addresses.map((address) => ({
    key: counterKeyOf(admin, address),
    rule: INVITATION_CEILING,
    amount: 1,
  })),
  { key: WORKSPACE_KEY, rule: WORKSPACE_INVITATION_CEILING, amount: addresses.length },
];

/** In key order, the workspace's last, so two actions sharing a counter queue rather than deadlock; past either ceiling the action fails whole. */
export const emailsCounted = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  addresses: readonly string[],
  now: Date,
): Promise<Result<undefined, CeilingMet>> => {
  const counters = countersOf(admin, addresses).toSorted((one, other) =>
    byCodeUnit(one.key, other.key),
  );
  for (const { key, rule, amount } of counters) {
    const counted = await consumeInvitationEmails(admin, tx, key, rule, now, amount);
    if (!counted.allowed) return err(new CeilingMet(counted.retryAfterSeconds));
  }
  return ok(undefined);
};

const ADDRESSES_WAITING = `SELECT lower(email) AS address FROM invitation
                            WHERE workspace_id = $1 AND id = ANY($2::text[]) AND status = $3`;

/** Read unlocked, so every action takes its counters before any invitation row it holds. */
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
