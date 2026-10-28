import type pg from "pg";

import type { INGRESS_SCOPES } from "@better-answers/schema";

import type { UserPrincipal } from "../../kernel/index.ts";
import type { PostgresDoor, Tx } from "./door.ts";

export type CounterRule = {
  readonly windowMs: number;
  readonly max: number;
};

export type CounterOutcome = {
  readonly allowed: boolean;

  readonly retryAfterSeconds: number;

  readonly count: number;
};

const windowStart = (rule: CounterRule, now: Date): Date =>
  new Date(Math.floor(now.getTime() / rule.windowMs) * rule.windowMs);

const outcome = (count: number, rule: CounterRule, start: Date, now: Date): CounterOutcome => ({
  allowed: count <= rule.max,
  retryAfterSeconds: Math.max(
    1,
    Math.ceil((start.getTime() + rule.windowMs - now.getTime()) / 1000),
  ),
  count,
});

const countInWindow = async (
  rule: CounterRule,
  now: Date,
  increment: (start: Date) => Promise<pg.QueryResult<{ count: number }>>,
): Promise<CounterOutcome> => {
  const start = windowStart(rule, now);
  const counted = await increment(start);
  return outcome(counted.rows[0]?.count ?? 1, rule, start, now);
};

/**
 * Counts one attempt in the fixed window `now` falls in. It commits at once. `retryAfterSeconds`
 * runs to the window's end, 1 at least.
 */
export const consumeIngress = async (
  door: PostgresDoor,
  scope: (typeof INGRESS_SCOPES)[number],
  key: string,
  rule: CounterRule,
  now: Date,
): Promise<CounterOutcome> =>
  countInWindow(rule, now, (start) =>
    door.pool.query<{ count: number }>(
      `WITH swept AS (
         DELETE FROM ingress_counter WHERE scope = $1 AND key = $2 AND window_start < $3
       )
       INSERT INTO ingress_counter (scope, key, window_start, count) VALUES ($1, $2, $3, 1)
       ON CONFLICT (scope, key, window_start) DO UPDATE SET count = ingress_counter.count + 1
       RETURNING count`,
      [scope, key, start],
    ),
  );

export const dropIngressWindowsBefore = async (
  door: PostgresDoor,
  before: Date,
): Promise<number> => {
  const dropped = await door.pool.query("DELETE FROM ingress_counter WHERE window_start < $1", [
    before,
  ]);
  return dropped.rowCount ?? 0;
};

const WORKSPACE_COUNTERS = {
  call: { table: "mcp_call_counter", keyColumn: "token_id", sweptBy: "token_id = $2" },
  invitationEmail: {
    table: "invitation_email_counter",
    keyColumn: "key",
    sweptBy: "workspace_id = $1 AND key = $2",
  },
} as const;

const countForWorkspace = async (
  principal: UserPrincipal,
  tx: Tx,
  counter: keyof typeof WORKSPACE_COUNTERS,
  key: string,
  rule: CounterRule,
  now: Date,
  amount: number,
): Promise<CounterOutcome> => {
  const { table, keyColumn, sweptBy } = WORKSPACE_COUNTERS[counter];
  return countInWindow(rule, now, (start) =>
    tx.query<{ count: number }>(
      `WITH swept AS (
         DELETE FROM ${table} WHERE ${sweptBy} AND window_start < $3
       )
       INSERT INTO ${table} (workspace_id, ${keyColumn}, window_start, count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, ${keyColumn}, window_start)
       DO UPDATE SET count = ${table}.count + EXCLUDED.count
       RETURNING count`,
      [principal.workspaceId, key, start, amount],
    ),
  );
};

export const consumeCall = async (
  principal: UserPrincipal,
  tx: Tx,
  tokenId: string,
  rule: CounterRule,
  now: Date,
): Promise<CounterOutcome> => countForWorkspace(principal, tx, "call", tokenId, rule, now, 1);

export const consumeInvitationEmails = async (
  principal: UserPrincipal,
  tx: Tx,
  key: string,
  rule: CounterRule,
  now: Date,
  amount: number,
): Promise<CounterOutcome> =>
  countForWorkspace(principal, tx, "invitationEmail", key, rule, now, amount);

export const returnInvitationEmails = async (
  principal: UserPrincipal,
  tx: Tx,
  key: string,
  rule: CounterRule,
  countedAt: Date,
  amount: number,
): Promise<void> => {
  await tx.query(
    `UPDATE invitation_email_counter SET count = GREATEST(count - $4, 0)
      WHERE workspace_id = $1 AND key = $2 AND window_start = $3`,
    [principal.workspaceId, key, windowStart(rule, countedAt), amount],
  );
};
