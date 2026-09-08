import { type MigratedPostgres, openMigratedPostgres } from "@better-answers/schema/testing";
import type pg from "pg";
import { afterAll, beforeAll } from "vitest";

import type { UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres, withPrincipal, type Tx } from "../src/store/postgres/index.ts";

/**
 * One migrated Postgres for a suite, started once and stopped once — the arrange block every
 * data suite in this package opens with, written once here.
 *
 * The shape is `apps/api/tests/suite-app.ts`'s `appForSuite`: the helper registers the
 * lifecycle and hands back an accessor, so a suite says what it needs on its first line and
 * reads the database from a call rather than from a `let` it has to remember is assigned.
 * It became a helper when a second suite wanted the same footing and the copy gate said so,
 * and every data suite in this package now opens on it, so this is the one line the package
 * reaches Postgres through.
 *
 * The database is copied from the template this run's `globalSetup` migrated, which
 * `vitest.config.ts` registers — so a file pays a `CREATE DATABASE` rather than a container
 * start, and the whole run pays one. What a suite receives is unchanged either way.
 */
export const postgresForSuite = (): (() => MigratedPostgres) => {
  let db: MigratedPostgres | undefined;

  // The allowance is a runaway guard, not a budget for the copy: it decides how long a
  // wedged cluster hangs before Vitest calls it, and a healthy hook never approaches it.
  // It stays at the container-start size because the opener still falls back to a container
  // of its own wherever nothing provided a warm one, and that fallback is what needs the
  // room — a first run on a machine with no image pulls it here.
  beforeAll(async () => {
    db = await openMigratedPostgres();
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  return () => {
    // Reached only from a test body, which runs after `beforeAll`; the throw is what a
    // caller gets instead of `undefined` if that ever stops being true.
    if (db === undefined) throw new Error("the suite's Postgres was read before it started");
    return db;
  };
};

/**
 * Run a read as this person, inside one transaction, the way a transport would — resolve
 * the Principal at the boundary and hand `work` the transaction it was resolved in. Shared
 * by every suite that reads as somebody, so which door a read goes through is one fact
 * here and not a copy per suite.
 */
export const readingAs = async <T>(
  pool: pg.Pool,
  reader: { readonly workspaceId: string; readonly userId: string },
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => {
  const read = await withPrincipal(
    openPostgres(pool),
    { workspaceId: reader.workspaceId, userId: reader.userId, issuedAt: new Date() },
    work,
  );
  if (!read.ok) throw new Error(`the principal did not resolve: ${read.error}`);
  return read.value;
};

/**
 * Wait for a condition the database reports, polling rather than sleeping: a slow machine
 * takes more turns to see the same state instead of failing a stopwatch. The cap is a
 * runaway guard, not a timing assumption — a test fails on it only if the state never
 * arrives at all.
 */
export const until = async (condition: () => Promise<boolean>): Promise<void> => {
  for (let turn = 0; turn < 200; turn += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the condition never held");
};

/** Whether anybody is waiting on this table — how a test knows an act has parked on it. */
export const isBlockedOnTable = async (pool: pg.Pool, table: string): Promise<boolean> => {
  const found = await pool.query(
    `SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE c.relname = $1 AND NOT l.granted`,
    [table],
  );
  return (found.rowCount ?? 0) > 0;
};

/**
 * Hold `table` against every other transaction while `work` runs, and let it go when `work`
 * returns — the seam a test needs to reach a window **inside** an act that exposes none.
 *
 * An act started inside `work` parks on its first statement against the table, so a test can
 * make the world move at exactly that point and then release. It is the act's own statements
 * that decide where it stops, so a test using this names the table it is stopping on and why.
 */
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

/**
 * Leave `tx` aborted, so the **next** statement an act runs on it fails — the shape of the
 * store failing under an act whose caller handed it a transaction, and the only way to reach
 * a slice's store-failure arm without mocking a door (`[TEST1]`, `[TEST3]`).
 *
 * The caller's own transaction is dead from here on, so a test using this asserts its
 * outcome as well as the act's value (`[TEST8]`).
 */
export const abortTheTransaction = async (tx: Tx): Promise<void> => {
  try {
    await tx.query("SELECT 1 / 0");
  } catch {
    // The failure is the arrangement, not a surprise: Postgres marks the transaction
    // aborted and answers every later statement on it with that, which is what an act is
    // about to meet.
  }
};

/**
 * Run `work` while the store refuses every write to `table` — a trigger that raises, which
 * is how a test fails **one** statement of an act whose earlier reads have to succeed. A
 * transaction it aborts is the caller's, so the same `[TEST8]` rule applies.
 *
 * `pool` is the superuser's: the trigger is DDL, and the runtime role holds none.
 */
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
  }
};
