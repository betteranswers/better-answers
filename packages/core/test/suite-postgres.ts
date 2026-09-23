import { ulid } from "@better-answers/schema";
import {
  openMigratedPostgres,
  testData,
  type MigratedPostgres,
  type TestData,
} from "@better-answers/schema/testing";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";

import type { Result, UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres, withPrincipal, type Opened, type Tx } from "../src/store/postgres/index.ts";

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

// For an act that reads every workspace the database holds, whose totals another case's rows
// would change.
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

export const readingAs = async <T>(
  pool: pg.Pool,
  reader: { readonly workspaceId: string; readonly userId: string },
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> =>
  withPrincipal(
    openPostgres(pool),
    { workspaceId: reader.workspaceId, userId: reader.userId, issuedAt: new Date() },
    work,
  );

export const answered = <Value, Refusal>(read: Result<Value, Refusal>): Value => {
  if (!read.ok) throw new Error(`the act answered ${String(read.error)}`);
  return read.value;
};

export const until = async (condition: () => Promise<boolean>): Promise<void> => {
  for (let turn = 0; turn < 1_800; turn += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the condition never held");
};

// No test can end a worker mid-run, so the row a departed claimant would have left is
// written instead, as the queue contract's `lapse_first` does.
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

export const whileActsWaitAt = async <T>(
  pool: pg.Pool,
  table: string,
  event: "INSERT" | "UPDATE",
  work: (release: () => Promise<void>) => Promise<T>,
): Promise<T> => {
  const holder = await pool.connect();
  const key = "hashtext('test-acts-wait-at')";
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await holder.query(`SELECT pg_advisory_unlock(${key}, ${key})`);
  };
  await holder.query(`SELECT pg_advisory_lock(${key}, ${key})`);
  await pool.query(
    `CREATE OR REPLACE FUNCTION test_acts_wait_at() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN PERFORM pg_advisory_xact_lock(${key}, ${key}); RETURN NEW; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER test_acts_wait_at BEFORE ${event} ON "${table}"
     FOR EACH ROW EXECUTE FUNCTION test_acts_wait_at()`,
  );
  try {
    return await work(release);
  } finally {
    await release();
    holder.release();
    await pool.query(`DROP TRIGGER test_acts_wait_at ON "${table}"`);
    await pool.query("DROP FUNCTION test_acts_wait_at()");
  }
};

export const countWaitingOnLocks = async (pool: pg.Pool): Promise<number> => {
  const found = await pool.query<{ waiting: string }>(
    "SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  );
  return Number(found.rows[0]?.waiting ?? 0);
};

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
