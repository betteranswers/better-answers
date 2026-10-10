import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";

import { ulid } from "@better-answers/schema";
import {
  endPool,
  openMigratedPostgres,
  testData,
  type MigratedPostgres,
  type TestData,
} from "@better-answers/schema/testing";

import type { Result, UserPrincipal } from "../src/kernel/index.ts";
import {
  folded,
  openPostgres,
  withPrincipal,
  type Foldable,
  type Folded,
  type Tx,
} from "../src/store/postgres/index.ts";

export const postgresForSuite = (): (() => MigratedPostgres) => {
  let db: MigratedPostgres | undefined;

  beforeAll(async () => {
    db = await openMigratedPostgres();
  });

  afterAll(async () => {
    await db?.stop();
  });

  return () => {
    if (db === undefined) throw new Error("the suite's Postgres was read before it started");
    return db;
  };
};

/**
 * For an action that reads every workspace the database holds, whose totals another case's rows
 * would change.
 */
export const postgresForEachCase = (): (() => MigratedPostgres) => {
  let db: MigratedPostgres | undefined;
  let cases = 0;

  beforeEach(async () => {
    cases += 1;
    const { testPath } = expect.getState();
    if (testPath === undefined) throw new Error("a case's Postgres is named after its test file");
    db = await openMigratedPostgres(`${testPath}#${String(cases)}`);
  });

  afterEach(async () => {
    await db?.stop();
    db = undefined;
  });

  return () => {
    if (db === undefined) throw new Error("the case's Postgres was read before it started");
    return db;
  };
};

/**
 * A pool as `app_rt` holding a connection per read, never reaped while idle: the suite's own
 * `runtimePool` holds five, and a sixth read waits.
 */
export const runtimePoolFor = (db: () => MigratedPostgres, reads: number): (() => pg.Pool) => {
  let pool: pg.Pool | undefined;

  beforeAll(() => {
    pool = new pg.Pool({
      connectionString: db().connectionUri,
      max: reads,
      idleTimeoutMillis: 0,
      options: "-c role=app_rt",
    });
  });

  afterAll(async () => {
    if (pool !== undefined) await endPool(pool);
  });

  return () => {
    if (pool === undefined) throw new Error("the readers' pool was read before it opened");
    return pool;
  };
};

export const addressOf = (person: string): string =>
  `${person}-${ulid().toLowerCase()}@example.invalid`;

export const seedingWith = async <T>(
  pool: pg.Pool,
  work: (seed: TestData) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    return await work(testData(client));
  } finally {
    client.release();
  }
};

/** Runs `work` as the member `reader`, in one transaction under row-level security; it may write. */
export const readingAs = async <T>(
  pool: pg.Pool,
  reader: { readonly workspaceId: string; readonly userId: string },
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T>> =>
  folded<T>(
    await withPrincipal(
      openPostgres(pool),
      { workspaceId: reader.workspaceId, userId: reader.userId, issuedAt: new Date() },
      work,
    ),
  );

export const answered = <Value, Refusal>(read: Result<Value, Refusal>): Value => {
  if (!read.ok) throw new Error(`the action answered ${String(read.error)}`);
  return read.value;
};

/** Polls 1,800 times, 25 ms apart: at least 45 seconds before it throws. */
export const until = async (condition: () => Promise<boolean>): Promise<void> => {
  for (let turn = 0; turn < 1_800; turn += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the condition never held");
};

/**
 * No test can end a worker mid-run, so the row a departed claimant would have left is
 * written instead, as the queue contract's `lapse_first` does.
 */
export const leaseLetLapse = async (
  pool: pg.Pool,
  job: { readonly workspaceId: string; readonly jobId: string },
): Promise<void> => {
  await pool.query(
    `UPDATE job SET status = 'claimed', attempts = 1, claimed_by = 'a worker that went away',
            claimed_at = now() - interval '5 minutes', heartbeat_at = now() - interval '5 minutes',
            lease_expires_at = now() - interval '30 seconds'
      WHERE workspace_id = $1 AND id = $2`,
    [job.workspaceId, job.jobId],
  );
};

export const isBlockedOnTable = async (pool: pg.Pool, table: string): Promise<boolean> => {
  const found = await pool.query(
    `SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE c.relname = $1 AND NOT l.granted`,
    [table],
  );
  return (found.rowCount ?? 0) > 0;
};

/** Holds an ACCESS EXCLUSIVE lock on `table`, from a connection of its own, while `work` runs. */
export const holdingTable = async <T>(
  pool: pg.Pool,
  table: string,
  work: () => Promise<T>,
): Promise<T> => {
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);
    return await work();
  } finally {
    await holder.query("COMMIT");
    holder.release();
  }
};

export const abortTheTransaction = async (tx: Tx): Promise<void> => {
  try {
    await tx.query("SELECT 1 / 0");
  } catch {
    // The failure is the arrangement: Postgres marks the transaction aborted and answers
    // every later statement on it with that.
  }
};

/**
 * Once released, actions pass `in turn`, each holding the rest back until it commits, or all
 * `together`, so their statements interleave.
 */
type Released = "in turn" | "together";

const HOLD_OF: Readonly<Record<Released, string>> = {
  "in turn": "pg_advisory_xact_lock",
  together: "pg_advisory_xact_lock_shared",
};

/** Each `event` on `table` blocks until `work` calls `release` or ends. */
export const whileActionsWaitAt = async <T>(
  pool: pg.Pool,
  table: string,
  event: "INSERT" | "UPDATE",
  work: (release: () => Promise<void>) => Promise<T>,
  released: Released = "in turn",
): Promise<T> => {
  const holder = await pool.connect();
  const key = "hashtext('test-actions-wait-at')";
  let unlocked = false;
  const release = async (): Promise<void> => {
    if (unlocked) return;
    unlocked = true;
    await holder.query(`SELECT pg_advisory_unlock(${key}, ${key})`);
  };
  await holder.query(`SELECT pg_advisory_lock(${key}, ${key})`);
  await pool.query(
    `CREATE OR REPLACE FUNCTION test_actions_wait_at() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN PERFORM ${HOLD_OF[released]}(${key}, ${key}); RETURN NEW; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER test_actions_wait_at BEFORE ${event} ON "${table}"
     FOR EACH ROW EXECUTE FUNCTION test_actions_wait_at()`,
  );
  try {
    return await work(release);
  } finally {
    await release();
    holder.release();
    await pool.query(`DROP TRIGGER test_actions_wait_at ON "${table}"`);
    await pool.query("DROP FUNCTION test_actions_wait_at()");
  }
};

export const statementsWaitingOnALock = async (pool: pg.Pool): Promise<readonly string[]> => {
  const found = await pool.query<{ query: string }>(
    "SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  );
  return found.rows.map((row) => row.query);
};

export const countWaitingOnLocks = async (pool: pg.Pool): Promise<number> =>
  (await statementsWaitingOnALock(pool)).length;

/** Starts every action, lets them past `table`'s inserts once each waits on a lock, and answers each. */
export const racedAt = <T>(
  pool: pg.Pool,
  table: string,
  actions: readonly (() => Promise<T>)[],
  released: Released = "in turn",
): Promise<readonly T[]> =>
  whileActionsWaitAt(
    pool,
    table,
    "INSERT",
    async (release) => {
      const racing = actions.map((action) => action());
      await until(async () => (await countWaitingOnLocks(pool)) === actions.length);
      await release();
      return Promise.all(racing);
    },
    released,
  );

export const whileWritesAreRefused = async <T>(
  pool: pg.Pool,
  table: string,
  work: () => Promise<T>,
): Promise<T> => {
  await pool.query(
    `CREATE OR REPLACE FUNCTION test_refuse_write() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'the store refused a write to %', TG_TABLE_NAME; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER test_refuse_write BEFORE INSERT OR UPDATE OR DELETE ON "${table}"
     FOR EACH ROW EXECUTE FUNCTION test_refuse_write()`,
  );
  try {
    return await work();
  } finally {
    await pool.query(`DROP TRIGGER test_refuse_write ON "${table}"`);
    await pool.query("DROP FUNCTION test_refuse_write()");
  }
};
