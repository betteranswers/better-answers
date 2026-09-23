import { boundarySchemas, ROLES } from "@better-answers/schema";
import type pg from "pg";

import { err, ok, type Result } from "../../kernel/index.ts";
import type {
  Claims,
  PlatformPrincipal,
  Principal,
  PrincipalRefusal,
  Role,
  UserId,
  UserPrincipal,
  WorkspaceId,
} from "../../kernel/index.ts";

export type PostgresDoor = {
  readonly pool: pg.Pool;
};

export const openPostgres = (pool: pg.Pool): PostgresDoor => ({ pool });

export const scopeClause = (at: number): string =>
  `COALESCE($${at}::text, (select current_workspace_id()))`;

export const scopeParameter = (principal: Principal): string | null =>
  principal.kind === "user" ? principal.workspaceId : null;

export type Tx = Pick<pg.PoolClient, "query">;

export type TxRow = pg.QueryResultRow;

type AnyResult = Result<unknown, unknown>;

type WhollyAResult<T> = [T] extends [AnyResult] ? true : false;

type PartlyAResult<T> = [Extract<T, AnyResult>] extends [never] ? false : true;

type Unwrapped<T> = T extends { readonly ok: true; readonly value: infer Value } ? Value : never;

type Refused<T> = T extends { readonly ok: false; readonly error: infer Refusal } ? Refusal : never;

// A union only partly a Result has no answer to fold: its Result members would reach the caller as
// values, a refusal among them.
type OnlyPartlyAResult<T> = WhollyAResult<T> extends true ? false : PartlyAResult<T>;

export type Answered<T> =
  OnlyPartlyAResult<T> extends true ? never : WhollyAResult<T> extends true ? Unwrapped<T> : T;

export type Foldable<T> = OnlyPartlyAResult<T> extends true ? never : T;

type Opened<T> = Result<T, PrincipalRefusal>;

export type Folded<T, Failure = never> = Result<
  Answered<T>,
  Refused<T> | PrincipalRefusal | Failure
>;

const answersAResult = <T>(answer: T): answer is T & AnyResult =>
  typeof answer === "object" &&
  answer !== null &&
  "ok" in answer &&
  (answer.ok === true ? "value" in answer : answer.ok === false && "error" in answer);

const answersARefusal = <T>(answer: T): boolean => answersAResult(answer) && !answer.ok;

export const folded = <T>(opened: Opened<Foldable<T>>): Folded<T> => {
  if (!opened.ok) return err(opened.error);
  const answer = opened.value;
  // SAFETY: the predicate reads the key the type reads, so each branch returns its own half.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- `Folded<T>` is conditional on a `T` still open here, which no runtime predicate resolves for the compiler
  return (answersAResult(answer) ? answer : ok(answer)) as Folded<T>;
};

const rollbackQuietly = async (client: pg.PoolClient): Promise<void> => {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The connection is already gone; releasing it below is all that is left.
  }
};

const commit = async (client: pg.PoolClient): Promise<void> => {
  const answer = await client.query("COMMIT");

  if (answer.command !== "COMMIT") {
    throw new Error(
      `the transaction did not commit: Postgres answered "${answer.command}" — a failed statement was caught inside the work, and nothing landed`,
    );
  }
};

// Every door opens its transaction here, so a refusal after a write leaves nothing behind whichever
// door the work came through.
const transaction = async <T>(
  door: PostgresDoor,
  work: (client: pg.PoolClient) => Promise<T>,
  refuses: (answer: T) => boolean = answersARefusal,
): Promise<T> => {
  const client = await door.pool.connect();
  try {
    await client.query("BEGIN");
    const answer = await work(client);
    if (refuses(answer)) await rollbackQuietly(client);
    else await commit(client);
    return answer;
  } catch (cause) {
    await rollbackQuietly(client);
    throw cause;
  } finally {
    client.release();
  }
};

const scopeTo = async (tx: Tx, workspaceId: string): Promise<void> => {
  await tx.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
};

export const withScope = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: string,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> =>
  transaction(door, async (client) => {
    await scopeTo(client, workspaceId);
    return work(client, platform);
  });

// A session lock outlives the connection's return to the pool, so it takes its own connection
// and an explicit unlock.
export const withSessionLock = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  key: number,
  work: (platform: PlatformPrincipal) => Promise<T>,
): Promise<T> => {
  const holder = await door.pool.connect();
  try {
    await holder.query("SELECT pg_advisory_lock($1)", [key]);
    try {
      return await work(platform);
    } finally {
      await holder.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    holder.release();
  }
};

export const withIdentityWrite = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> => transaction(door, (client) => work(client, platform));

/* jscpd:ignore-start */
export const withIdentityRead = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> => transaction(door, (client) => work(client, platform));
/* jscpd:ignore-end */

const MEMBERSHIP_QUERY = `SELECT m.role AS role, u.credentials_revoked_at AS person_revoked_at,
            m.credentials_revoked_at AS membership_revoked_at,
            COALESCE((SELECT array_agg(gm.group_id ORDER BY gm.group_id)
                        FROM group_member gm
                       WHERE gm.workspace_id = m.workspace_id AND gm.user_id = m.user_id),
                     '{}') AS group_ids
     FROM member m
     JOIN "user" u ON u.id = m.user_id
    WHERE m.workspace_id = $1 AND m.user_id = $2`;

// Both rows held, or a revocation lands between the read and the commit; never on the
// boundary read, which every request runs.
const MEMBERSHIP_QUERY_HELD = `${MEMBERSHIP_QUERY} FOR SHARE OF m, u`;

const isRole = (value: string): value is Role => ROLES.some((role) => role === value);

type MembershipRow = {
  readonly role: string;
  readonly person_revoked_at: Date | null;
  readonly membership_revoked_at: Date | null;
  readonly group_ids: readonly string[];
};

const resolveClaims = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
  query: string,
): Promise<Opened<T>> => {
  const workspaceId = boundarySchemas.workspace.select.shape.id.safeParse(claims.workspaceId);
  const userId = boundarySchemas.user.select.shape.id.safeParse(claims.userId);
  if (!workspaceId.success || !userId.success) return err("malformed-claims");

  const credentialIssuedAtMs = claims.issuedAt.getTime();

  return resolveScoped(
    door,
    workspaceId.data,
    userId.data,
    credentialIssuedAtMs,
    (row) => {
      const refusal = refuse(row, credentialIssuedAtMs);
      if (!refusal.ok) return refusal;

      return claims.role === undefined || claims.role === refusal.value.role
        ? refusal
        : err("role-disagrees");
    },
    work,
    query,
  );
};

export const withPrincipal = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => resolveClaims(door, claims, work, MEMBERSHIP_QUERY);

export const withHeldPrincipal = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => resolveClaims(door, claims, work, MEMBERSHIP_QUERY_HELD);

export const withMembership = async <T>(
  principal: UserPrincipal,
  door: PostgresDoor,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> =>
  resolveScoped(
    door,
    principal.workspaceId,
    principal.userId,
    principal.credentialIssuedAtMs,
    (row) => {
      const refusal = refuse(row, principal.credentialIssuedAtMs);
      if (!refusal.ok) return refusal;

      return refusal.value.role === principal.role ? refusal : err("role-disagrees");
    },
    work,
    MEMBERSHIP_QUERY_HELD,
  );

const resolveScoped = async <T>(
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  userId: UserId,
  credentialIssuedAtMs: number,
  refusalFor: (row: MembershipRow | undefined) => Result<ResolvedMember, PrincipalRefusal>,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
  query: string,
): Promise<Opened<T>> =>
  transaction(
    door,
    async (client): Promise<Opened<T>> => {
      await scopeTo(client, workspaceId);

      const membership = await client.query<MembershipRow>(query, [workspaceId, userId]);
      const resolved = refusalFor(membership.rows[0]);
      if (!resolved.ok) return err(resolved.error);

      const principal: UserPrincipal = {
        kind: "user",
        workspaceId,
        userId,
        role: resolved.value.role,

        groups: resolved.value.group_ids.map((id) =>
          boundarySchemas.group.select.shape.id.parse(id),
        ),
        credentialIssuedAtMs,
      };
      return ok(await work(principal, client));
    },
    (opened) => !opened.ok || answersARefusal(opened.value),
  );

type ResolvedMember = MembershipRow & { readonly role: Role };

const refuse = (
  row: MembershipRow | undefined,
  credentialIssuedAtMs: number,
): Result<ResolvedMember, PrincipalRefusal> => {
  if (row === undefined) return err("not-a-member");

  if (!isRole(row.role)) return err("role-unknown");

  for (const revokedAt of [row.person_revoked_at, row.membership_revoked_at]) {
    if (revokedAt !== null && credentialIssuedAtMs < revokedAt.getTime()) {
      return err("credentials-revoked");
    }
  }
  return ok({ ...row, role: row.role });
};

export type CounterRule = {
  readonly windowMs: number;
  readonly max: number;
};

export type CounterOutcome = {
  readonly allowed: boolean;

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

export const consumeIngress = async (
  door: PostgresDoor,
  scope: "ip" | "email",
  key: string,
  rule: CounterRule,
  now: Date,
): Promise<CounterOutcome> => {
  const start = windowStart(rule, now);

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

export const consumeCall = async (
  principal: UserPrincipal,
  tx: Tx,
  tokenId: string,
  rule: CounterRule,
  now: Date,
): Promise<CounterOutcome> => {
  const start = windowStart(rule, now);

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
