import type pg from "pg";

import { boundarySchemas, ROLES } from "@better-answers/schema";

import { err, ok, type Result } from "../../kernel/index.ts";
import type {
  Claims,
  KernelRefusal,
  OperatorPrincipal,
  OperatorRefusal,
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

/**
 * A SQL expression for the workspace in parameter `$at`, or for the transaction's own scope when
 * that parameter is null.
 */
export const scopeClause = (at: number): string =>
  `COALESCE($${at}::text, (select current_workspace_id()))`;

/**
 * Null for the platform and the operator, so that scopeClause falls back to the transaction's
 * scope; the operator's holds none, so no row of a workspace's lands under them.
 */
export const scopeParameter = (principal: Principal | OperatorPrincipal): string | null =>
  principal.kind === "user" ? principal.workspaceId : null;

/** An `ILIKE` pattern matching `text` anywhere, its own `%`, `_` and `\` taken literally. */
export const containing = (text: string): string =>
  `%${text.replaceAll(/[\\%_]/g, String.raw`\$&`)}%`;

export type Tx = Pick<pg.PoolClient, "query">;

export type TxRow = pg.QueryResultRow;

type AnyResult = Result<unknown, unknown>;

type WhollyAResult<T> = [T] extends [AnyResult] ? true : false;

type PartlyAResult<T> = [Extract<T, AnyResult>] extends [never] ? false : true;

type Unwrapped<T> = T extends { readonly ok: true; readonly value: infer Value } ? Value : never;

type Refused<T> = T extends { readonly ok: false; readonly error: infer Refusal } ? Refusal : never;

/**
 * A union only partly a Result has no answer to fold: its Result members would reach the caller
 * as values, a refusal among them.
 */
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

/**
 * One Result for an opened work: the principal's refusal, the Result the work answered, or else
 * the work's answer as the value.
 */
export const folded = <T>(opened: Opened<Foldable<T>>): Folded<T> => {
  if (!opened.ok) return err(opened.error);
  const answer = opened.value;
  // oxlint-disable-next-line typescript/consistent-type-assertions -- `Folded<T>` turns on a `T` still open here, which no runtime check narrows
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

/**
 * Every door opens its transaction here, so a refusal after a write leaves nothing behind
 * whichever door the work came through.
 */
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

const DEADLOCK_DETECTED = "40P01";

/**
 * Two acts each waiting on a lock the other holds: Postgres aborts one, and that act answers
 * `changed-meanwhile` rather than failing. Any other error is itself.
 */
export const refusalOfDeadlock = (error: Error): KernelRefusal<"changed-meanwhile"> | Error =>
  "code" in error && error.code === DEADLOCK_DETECTED ? "changed-meanwhile" : error;

const scopeTo = async (tx: Tx, workspaceId: string): Promise<void> => {
  await tx.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
};

/**
 * Runs `work` in one transaction scoped to `workspaceId`. It rolls back when `work` throws or
 * answers a refused Result.
 */
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

/** A session lock outlives the connection's return to the pool, so it holds a connection alone. */
const onOwnConnection = async <T>(
  door: PostgresDoor,
  use: (holder: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const holder = await door.pool.connect();
  try {
    return await use(holder);
  } finally {
    holder.release();
  }
};

const unlockingAfter = async <T>(
  holder: pg.PoolClient,
  key: number,
  work: () => Promise<T>,
): Promise<T> => {
  try {
    return await work();
  } finally {
    await holder.query("SELECT pg_advisory_unlock($1)", [key]);
  }
};

/**
 * Waits for the session lock on `key`, runs `work` outside any transaction, and unlocks once
 * `work` settles, failed or not.
 */
export const withSessionLock = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  key: number,
  work: (platform: PlatformPrincipal) => Promise<T>,
): Promise<T> =>
  onOwnConnection(door, async (holder) => {
    await holder.query("SELECT pg_advisory_lock($1)", [key]);
    return unlockingAfter(holder, key, () => work(platform));
  });

export type LockHeld = "held";

/**
 * As withSessionLock, but `held` at once while another session holds `key`, so a second holder
 * skips its work rather than queueing behind the first.
 */
export const withSessionTryLock = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  key: number,
  work: (platform: PlatformPrincipal) => Promise<T>,
): Promise<Result<T, LockHeld>> =>
  onOwnConnection(door, async (holder): Promise<Result<T, LockHeld>> => {
    const tried = await holder.query<{ taken: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS taken",
      [key],
    );
    if (tried.rows[0]?.taken !== true) return err("held");
    return ok(await unlockingAfter(holder, key, () => work(platform)));
  });

/**
 * Runs `work` in one transaction with no workspace scope. It rolls back when `work` throws or
 * answers a refused Result.
 */
export const withIdentityWrite = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> => transaction(door, (client) => work(client, platform));

/* jscpd:ignore-start */
/** The same transaction as withIdentityWrite: nothing stops its work from writing. */
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

/**
 * Both rows held, or a revocation lands between the read and the commit; never on the boundary
 * read, which every request runs.
 */
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

/**
 * Resolves `claims` to a member of the workspace they name, then runs `work` as that member in one
 * transaction scoped to it. Refuses malformed claims, a non-member, an unknown role, credentials
 * issued before a revocation, and a role the claims name that the member row does not hold.
 */
export const withPrincipal = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => resolveClaims(door, claims, work, MEMBERSHIP_QUERY);

/**
 * As withPrincipal, but the member and user rows stay held until commit, so a revocation cannot
 * land between the read and the commit.
 */
export const withHeldPrincipal = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => resolveClaims(door, claims, work, MEMBERSHIP_QUERY_HELD);

/**
 * Reads the principal's member row again, held as withHeldPrincipal holds it, and runs `work` as
 * the principal read back, groups included. Refuses a non-member, an unknown role, revoked
 * credentials, and a role that has moved.
 */
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

type OperatorRow = {
  readonly id: string;
  readonly operator: boolean;
  readonly revoked_at: Date | null;
};

const carriesTheMark = (
  row: OperatorRow | undefined,
  credentialIssuedAtMs: number,
): row is OperatorRow =>
  row !== undefined &&
  row.operator &&
  (row.revoked_at === null || credentialIssuedAtMs >= row.revoked_at.getTime());

/**
 * Resolves a signed-in person to the operator, then runs `work` as them in one transaction scoped
 * to no workspace. Refuses `not-the-operator` to anyone else: a person without the mark, credentials
 * issued before their revocation, an id no person holds.
 */
export const withOperator = async <T>(
  door: PostgresDoor,
  claims: Pick<Claims, "userId" | "issuedAt">,
  work: (operator: OperatorPrincipal, tx: Tx) => Promise<T>,
): Promise<Result<T, OperatorRefusal>> => {
  const credentialIssuedAtMs = claims.issuedAt.getTime();

  return transaction(
    door,
    async (client): Promise<Result<T, OperatorRefusal>> => {
      const found = await client.query<OperatorRow>(
        'SELECT id, operator, credentials_revoked_at AS revoked_at FROM "user" WHERE id = $1',
        [claims.userId],
      );
      const row = found.rows[0];
      if (!carriesTheMark(row, credentialIssuedAtMs)) return err("not-the-operator");

      const operator: OperatorPrincipal = {
        kind: "operator",
        userId: boundarySchemas.user.select.shape.id.parse(row.id),
        credentialIssuedAtMs,
      };
      return ok(await work(operator, client));
    },
    (opened) => !opened.ok || answersARefusal(opened.value),
  );
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
 * Counts one attempt against `scope` and `key` in the fixed window `now` falls in, and drops the
 * pair's earlier windows. It commits at once. `retryAfterSeconds` runs to the window's end, 1 at
 * least.
 */
export const consumeIngress = async (
  door: PostgresDoor,
  scope: "ip" | "email" | "person",
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

/** As consumeIngress, for one call on the token `tokenId`, inside the caller's transaction. */
export const consumeCall = async (
  principal: UserPrincipal,
  tx: Tx,
  tokenId: string,
  rule: CounterRule,
  now: Date,
): Promise<CounterOutcome> =>
  countInWindow(rule, now, (start) =>
    tx.query<{ count: number }>(
      `WITH swept AS (
         DELETE FROM mcp_call_counter WHERE token_id = $2 AND window_start < $3
       )
       INSERT INTO mcp_call_counter (workspace_id, token_id, window_start, count) VALUES ($1, $2, $3, 1)
       ON CONFLICT (workspace_id, token_id, window_start) DO UPDATE SET count = mcp_call_counter.count + 1
       RETURNING count`,
      [principal.workspaceId, tokenId, start],
    ),
  );

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
 * Those of `names` that `information_schema.tables` lists in `public`, in no set order: a view
 * counts, and a table the role holds no privilege on does not.
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
