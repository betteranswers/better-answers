import {
  openMigratedPostgres,
  testData,
  type MigratedPostgres,
  type TestData,
} from "@better-answers/schema/testing";
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

  beforeAll(async () => {
    db = await openMigratedPostgres();
  });

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
 * Build rows through the factory, as the superuser, on one connection given back at the
 * end — the arrange every suite that seeds a map opens with. Beside `readingAs` for the
 * same reason: which pool a seed goes through is one fact here, not a copy per suite, and
 * the copy gate said so the second time it was written.
 */
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
