import { boundarySchemas, ROLES } from "@better-answers/schema";
import type pg from "pg";

import { err, ok, type Result } from "../../kernel/index.ts";
import type {
  Claims,
  PlatformPrincipal,
  PrincipalRefusal,
  Role,
  UserId,
  UserPrincipal,
  WorkspaceId,
} from "../../kernel/index.ts";

/**
 * The Postgres door: the handle, the transaction helper, and the RLS session setter.
 *
 * `SET LOCAL app.workspace_id` from the `Principal` on every transaction. RLS with
 * `FORCE ROW LEVEL SECURITY`, the non-owner `app_rt` role and default-deny
 * (`pgTable.withRLS()`) is the tenancy **guarantee**; this door is ergonomics over it
 * (ADR 0029). Drizzle exposes no query lifecycle hook, so there is no interception
 * pattern to port — the guarantee lives in the database.
 *
 * ADR 0029 rule 2 — `store` imports only `kernel` (and the schema package, which is
 * not `core`). No store file imports another store file.
 */

/** The handle: one pool, connected as the runtime role (`app_rt` in every estate). */
export type PostgresDoor = {
  readonly pool: pg.Pool;
};

export const openPostgres = (pool: pg.Pool): PostgresDoor => ({ pool });

/**
 * One transaction's client. Narrow on purpose: a slice runs statements on it and
 * nothing else — it cannot commit, release or open a second transaction.
 */
export type Tx = Pick<pg.PoolClient, "query">;

const rollbackQuietly = async (client: pg.PoolClient): Promise<void> => {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The connection is already gone; releasing it below is all that is left.
  }
};

const commit = async (client: pg.PoolClient): Promise<void> => {
  const answer = await client.query("COMMIT");
  // In an aborted transaction Postgres answers COMMIT with the tag ROLLBACK and no
  // error, so a statement failure the work caught would otherwise be reported as
  // success over rows that never landed. The tag is the only place the abort shows.
  if (answer.command !== "COMMIT") {
    throw new Error(
      `the transaction did not commit: Postgres answered "${answer.command}" — a failed statement was caught inside the work, and nothing landed`,
    );
  }
};

const transaction = async <T>(
  door: PostgresDoor,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await door.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await commit(client);
    return result;
  } catch (cause) {
    await rollbackQuietly(client);
    throw cause;
  } finally {
    client.release();
  }
};

/**
 * Run `work` inside one transaction scoped to `workspaceId`, as the platform. The
 * setter every tenant read goes through; `withPrincipal` is the door a person's call
 * uses, this is for the platform's own acts — provisioning, the identity provider's
 * hooks — where a platform principal, not a person, is behind the call: the platform
 * principal is the first argument, and the act is audited under its id.
 */
export const withScope = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: string,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> =>
  transaction(door, async (client) => {
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    return work(client, platform);
  });

/**
 * Run `work` inside one transaction with no scope, as the platform: a write to the
 * identity set (ADR 0009), which no workspace scope reaches — revoking a person's
 * credentials, for one. Never a tenant read: an unscoped transaction sees zero tenant
 * rows by construction.
 */
export const withIdentityWrite = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> => transaction(door, (client) => work(client, platform));

/**
 * The read twin: one unscoped transaction, as the platform, over the identity set — the
 * reads that happen *before* a workspace is known and so cannot be scoped, the picker's
 * "which workspaces does this person hold" among them (ADR 0035). Its own name rather
 * than `withIdentityWrite`'s, because a caller reading this file should be able to tell
 * which of the two a statement is; and its own door rather than the raw pool, so that
 * every statement in a slice still reaches Postgres through a door with the principal it
 * is made under in its hand (ADR 0029's amendment).
 *
 * Never a tenant read: an unscoped transaction sees zero tenant rows by construction,
 * which is the guarantee, not an omission.
 *
 * The body is its twin's, deliberately, and the `jscpd:ignore` fence around it is that
 * decision said again where the copy-paste gate can read it: the two are one implementation
 * under two names on purpose, so that a statement says which of them it is, and they have to
 * be able to part — the day a read takes a read-only transaction, only this one changes.
 */
/* jscpd:ignore-start */
export const withIdentityRead = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> => transaction(door, (client) => work(client, platform));
/* jscpd:ignore-end */

/**
 * The one resolve query (ADR 0018, ADR 0035, ADR 0038): the member row, the person's
 * revocation instant, this membership's, and every group they are in here. All of it
 * comes back in the one statement — a revocation and a group membership each cost no
 * second round trip on the path every call takes.
 *
 * The group ids are re-read on every call rather than carried on a credential (ADR 0009),
 * which is what lets an Admin's *add to group* take effect on the person's next request;
 * the subquery runs inside the scope this transaction has already set, so the policy on
 * `group_member` is a second fence behind the workspace the join already names.
 */
const MEMBERSHIP_QUERY = `SELECT m.role AS role, u.credentials_revoked_at AS person_revoked_at,
            m.credentials_revoked_at AS membership_revoked_at,
            COALESCE((SELECT array_agg(gm.group_id ORDER BY gm.group_id)
                        FROM group_member gm
                       WHERE gm.workspace_id = m.workspace_id AND gm.user_id = m.user_id),
                     '{}') AS group_ids
     FROM member m
     JOIN "user" u ON u.id = m.user_id
    WHERE m.workspace_id = $1 AND m.user_id = $2`;

const isRole = (value: string): value is Role => ROLES.some((role) => role === value);

/**
 * What the resolve query returns: the member row's role, revocation's two instants — the
 * person's, written by the operator's act, and this membership's, written by an Admin of
 * this workspace and reaching no other — and the ids of the groups they are in here,
 * empty when they are in none.
 */
type MembershipRow = {
  readonly role: string;
  readonly person_revoked_at: Date | null;
  readonly membership_revoked_at: Date | null;
  readonly group_ids: readonly string[];
};

/**
 * The Principal resolver — the deep module of T-004.
 *
 * Opens one transaction, sets its scope from the claims, reads the member row and
 * revocation's two instants — the person's `user.credentials_revoked_at` and this
 * membership's `member.credentials_revoked_at` — in that transaction, and runs `work`
 * in the same transaction with the Principal it built. So the role is resolved **in
 * the same transaction as the read it authorises**, every failure is a refusal (the
 * transaction rolls back; there is no default role), and the Principal cannot outlive
 * the request because it exists only inside `work`.
 *
 * Refusals: no member row for the pair; a credential issued before either instant,
 * which is one word, `credentials-revoked`, for both scopes, so the People screen
 * shows one outcome and the refusal says nothing about whether the person belongs
 * anywhere else (ADR 0035); a credential carrying a role the member row disagrees
 * with; a member row whose role is not one of the three; claims that fail the
 * boundary's shape. Each is its own test in `packages/core/test/principal.test.ts`.
 */
export const withPrincipal = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Result<T, PrincipalRefusal>> => {
  const workspaceId = boundarySchemas.workspace.select.shape.id.safeParse(claims.workspaceId);
  const userId = boundarySchemas.user.select.shape.id.safeParse(claims.userId);
  if (!workspaceId.success || !userId.success) return err("malformed-claims");

  const client = await door.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId.data]);

    const membership = await client.query<MembershipRow>(MEMBERSHIP_QUERY, [
      workspaceId.data,
      userId.data,
    ]);
    const row = membership.rows[0];
    const refusal = refuse(row, claims);
    if (refusal !== undefined) {
      await rollbackQuietly(client);
      return err(refusal);
    }
    // `refuse` returned nothing, so the row exists and its role is one of the three;
    // the narrowing is repeated here because TypeScript cannot carry it across the call.
    const role = row?.role ?? "";
    if (!isRole(role)) {
      await rollbackQuietly(client);
      return err("role-unknown");
    }

    const principal: UserPrincipal = {
      kind: "user",
      workspaceId: workspaceId.data satisfies WorkspaceId,
      userId: userId.data satisfies UserId,
      role,
      // Parsed at the boundary rather than asserted (ADR 0028): the column is a foreign
      // key to a group the platform minted, so a value of another shape is a broken
      // database and the throw the caller sees is the truthful answer to it.
      groups: (row?.group_ids ?? []).map((id) => boundarySchemas.group.select.shape.id.parse(id)),
    };
    const value = await work(principal, client);
    await commit(client);
    return ok(value);
  } catch (cause) {
    await rollbackQuietly(client);
    throw cause;
  } finally {
    client.release();
  }
};

const refuse = (row: MembershipRow | undefined, claims: Claims): PrincipalRefusal | undefined => {
  if (row === undefined) return "not-a-member";
  if (!isRole(row.role)) return "role-unknown";
  // Either instant refuses, with the one word: revoked everywhere, or revoked here.
  for (const revokedAt of [row.person_revoked_at, row.membership_revoked_at]) {
    if (revokedAt !== null && claims.issuedAt < revokedAt) return "credentials-revoked";
  }
  if (claims.role !== undefined && claims.role !== row.role) return "role-disagrees";
  return undefined;
};

/** A fixed-window rule: at most `max` events per `windowMs`. */
export type CounterRule = {
  readonly windowMs: number;
  readonly max: number;
};

export type CounterOutcome = {
  readonly allowed: boolean;
  /** Seconds until the window turns over — the `Retry-After` a refusal carries. */
  readonly retryAfterSeconds: number;
};

const windowStart = (rule: CounterRule, now: Date): Date =>
  new Date(Math.floor(now.getTime() / rule.windowMs) * rule.windowMs);

const outcome = (count: number, rule: CounterRule, start: Date, now: Date): CounterOutcome => ({
  allowed: count <= rule.max,
  retryAfterSeconds: Math.max(
    1,
    Math.ceil((start.getTime() + rule.windowMs - now.getTime()) / 1000),
  ),
});

/**
 * One statement on the pre-authentication counter: upsert `(scope, key, window)` with
 * `count + 1` and read the count back. Global table, no scope needed — there is no
 * workspace before authentication.
 */
export const consumeIngress = async (
  door: PostgresDoor,
  scope: "ip" | "email",
  key: string,
  rule: CounterRule,
  now: Date = new Date(),
): Promise<CounterOutcome> => {
  const start = windowStart(rule, now);
  // One statement: the key's expired windows go as its current one is counted, so the
  // table holds at most one live row per key and never becomes the load it sheds.
  const counted = await door.pool.query<{ count: number }>(
    `WITH swept AS (
       DELETE FROM ingress_counter WHERE scope = $1 AND key = $2 AND window_start < $3
     )
     INSERT INTO ingress_counter (scope, key, window_start, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (scope, key, window_start) DO UPDATE SET count = ingress_counter.count + 1
     RETURNING count`,
    [scope, key, start],
  );
  return outcome(counted.rows[0]?.count ?? 1, rule, start, now);
};

/**
 * One statement on the per-token counter, inside the tool call's own transaction
 * (ADR 0018: a Postgres counter per `(token, window)`). The row carries the
 * workspace id, so RLS keeps one workspace's tokens from ever reading another's.
 */
export const consumeCall = async (
  principal: UserPrincipal,
  tx: Tx,
  tokenId: string,
  rule: CounterRule,
  now: Date = new Date(),
): Promise<CounterOutcome> => {
  const start = windowStart(rule, now);
  // The token's expired windows go as its current one is counted, so a workspace holds
  // at most one live row per token and the counter never becomes the load it sheds.
  const counted = await tx.query<{ count: number }>(
    `WITH swept AS (
       DELETE FROM mcp_call_counter WHERE token_id = $2 AND window_start < $3
     )
     INSERT INTO mcp_call_counter (workspace_id, token_id, window_start, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (workspace_id, token_id, window_start) DO UPDATE SET count = mcp_call_counter.count + 1
     RETURNING count`,
    [principal.workspaceId, tokenId, start],
  );
  return outcome(counted.rows[0]?.count ?? 1, rule, start, now);
};

/**
 * A workspace's config row by key; `undefined` when unset. RLS already scopes the read;
 * the predicate says so in the statement: the Principal, first.
 */
export const readWorkspaceConfig = async (
  principal: UserPrincipal,
  tx: Tx,
  key: string,
): Promise<string | undefined> => {
  const found = await tx.query<{ value: string }>(
    "SELECT value FROM workspace_config WHERE workspace_id = $1 AND key = $2",
    [principal.workspaceId, key],
  );
  return found.rows[0]?.value;
};

/**
 * Which of `names` exist as tables in `public` — a catalogue read, not a tenant read, so
 * it runs outside any scope. The estate's restore commands ask this before acting: a
 * slice whose tables are absent has not landed, and "not built" is an answer the drill
 * records rather than a silence (T-005; `apps/api/src/ops/index.ts`).
 */
export const tablesPresent = async (
  door: PostgresDoor,
  names: readonly string[],
): Promise<readonly string[]> => {
  const result = await door.pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [names],
  );
  return result.rows.map((row) => row.table_name);
};
