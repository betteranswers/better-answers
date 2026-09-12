import { createHash } from "node:crypto";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { expect, inject } from "vitest";
import type { TestProject } from "vitest/node";

import { POSTGRES_IMAGE } from "../src/postgres-image.ts";
import {
  applyJournal,
  type MigratedPostgres,
  migratedPostgresOver,
  POSTGRES_COMMAND,
  startMigratedPostgres,
} from "./harness.ts";

/**
 * The warm half of the harness: one container and one migrated template per Vitest run,
 * a database per test file copied from that template.
 *
 * What it buys is the container start leaving the per-file path. Vitest initialises a
 * `globalSetup` once per project instance and tears it down only when the instance
 * closes, while a file's `beforeAll` re-runs on every mutant Stryker activates inside
 * that same instance — so under the nightly mutation run the container is started once a
 * worker rather than once a mutant (`docs/research/t-009-mutation-testing.md` §1.2–1.3).
 * A file still gets a fully migrated, empty database of its own, because all seeding is
 * per-test through the factory (`[TEST4]`) and a template copy is the migrated database
 * with zero rows in it.
 *
 * Register it from a workspace's Vitest config:
 * `globalSetup: ["@better-answers/schema/testing/warm-postgres"]`.
 *
 * Test-only surface: this file is never imported directly. `@better-answers/schema` hands
 * it out only through its own `./testing/warm-postgres` export in the package's `exports`
 * map — the root coding rules' rule on tests through the interface is what licenses that
 * entry — and never through a path into this package's `test/` tree.
 */

/** What `globalSetup` hands every test file: where the cluster is, and what to copy. */
export type WarmPostgres = {
  /**
   * The container's own database. A session cannot create or drop the database it is
   * connected to, so this is where a file issues its `CREATE DATABASE` from.
   */
  readonly connectionUri: string;
  /** The migrated database each file's database is copied from. */
  readonly templateDatabase: string;
};

declare module "vitest" {
  interface ProvidedContext {
    /**
     * Absent outside a Vitest run, and in a workspace whose Vitest config has not
     * registered this `globalSetup` — both of which the opener reads as "start your own".
     */
    warmPostgres?: WarmPostgres;
  }
}

/**
 * The template's name. One per container, and a container belongs to one Vitest instance,
 * so a fixed name cannot collide with anything.
 */
const TEMPLATE_DATABASE = "better_answers_template";

/**
 * An identifier Postgres reads literally. Every name reaching the DDL below is built in
 * this file out of `[a-z0-9_]`, so this changes nothing today; it is here so that the day
 * a name carries a character Postgres would fold or reject, the statement still names the
 * database the caller meant.
 */
const quoted = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

/** The same connection facts, pointed at another database on the same cluster. */
const uriForDatabase = (connectionUri: string, database: string): string => {
  const uri = new URL(connectionUri);
  uri.pathname = `/${database}`;
  return uri.toString();
};

/**
 * One short-lived superuser connection to the container's own database, for the `CREATE`
 * and `DROP` a file's database needs. A single client rather than a pool: a file's
 * connection budget is its two pools and nothing else, and this connection is gone before
 * the pools open.
 */
const withAdmin = async <T>(
  connectionUri: string,
  work: (admin: pg.Client) => Promise<T>,
): Promise<T> => {
  const admin = new pg.Client({ connectionString: connectionUri });
  await admin.connect();
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
};

/**
 * How long `stop()` waits for the sessions on a file's database to leave before dropping it
 * anyway. A backend that has read its Terminate leaves at once; the allowance is a runaway
 * guard for one that never reads it, so a wedged session cannot hold a teardown open to the
 * hook allowance.
 */
const SESSIONS_GONE_TIMEOUT_MS = 5_000;

/** How often the wait looks again. */
const SESSIONS_GONE_POLL_MS = 20;

/**
 * The sessions still open on a database: a file's own pools' clients on their way out, and
 * anything a test left connected. Client backends only, because an autovacuum worker on the
 * database carries its `datname` too and would hold the wait for nothing it owns.
 */
const sessionsOn = async (admin: pg.Client, database: string): Promise<number> => {
  const counted = await admin.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND backend_type = 'client backend'",
    [database],
  );
  return counted.rows[0]?.n ?? 0;
};

/**
 * Wait until no session is left on `database`, for at most the allowance above.
 *
 * Needed because `pool.end()` resolves before the pool's sockets have closed. pg-pool 3.14.0
 * fires the end callback as soon as its client list is empty (`index.js:140-143`), and
 * `_remove` empties that list synchronously *before* calling the client's own `end`
 * (`index.js:179-181`), which is what writes the Terminate message and half-closes the
 * socket (pg 8.23.0 `lib/connection.js:210-219`). So when `stop()` reaches the drop, every
 * backend has been told to leave and may not yet have read it. A `DROP DATABASE … WITH
 * (FORCE)` that lands first sends that backend SIGTERM; it answers on the still-open socket
 * with FATAL 57P01, which pg reads as a backend error message with no query active
 * (`lib/client.js:426-435`) and raises as `error` on the client (`lib/client.js:416-423`)
 * whatever its `_ending` says; the client's one listener hands it to the pool (pg-pool
 * `index.js:52-62`), and a pool with no `error` listener throws it — an unhandled error
 * blamed on whichever test file was tearing down.
 *
 * Waiting is chosen over giving the pools an `error` listener for the teardown window,
 * because a listener would keep the race and hide its symptom: the backend would still be
 * killed mid-goodbye, and any real error surfacing during a file's teardown would vanish
 * with it. Waiting removes the race — the `FORCE` reaches nothing of ours. It is bounded so
 * that a session which never leaves is dropped as it always was.
 */
const untilSessionsGone = async (admin: pg.Client, database: string): Promise<void> => {
  const deadline = Date.now() + SESSIONS_GONE_TIMEOUT_MS;
  while ((await sessionsOn(admin, database)) > 0 && Date.now() < deadline) {
    await sleep(SESSIONS_GONE_POLL_MS);
  }
};

/**
 * The Vitest `globalSetup`: one container, one migrated template, and the facts a file
 * needs to copy it. The migration pool is closed before anything is provided, because
 * Postgres refuses `CREATE DATABASE … TEMPLATE` while the template has a live connection —
 * the first file to open would fail with "source database is being accessed by other
 * users". The returned teardown is what stops the container, and Vitest calls it only when
 * the instance closes.
 */
const startWarmPostgres = async (project: TestProject): Promise<() => Promise<void>> => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand([...POSTGRES_COMMAND])
    .start();
  const connectionUri = container.getConnectionUri();
  try {
    await withAdmin(connectionUri, async (admin) => {
      await admin.query(`CREATE DATABASE ${quoted(TEMPLATE_DATABASE)}`);
    });
    const migrationPool = new pg.Pool({
      connectionString: uriForDatabase(connectionUri, TEMPLATE_DATABASE),
      max: 1,
    });
    try {
      await applyJournal(migrationPool);
    } finally {
      await migrationPool.end();
    }
  } catch (error) {
    await container.stop();
    throw error;
  }
  project.provide("warmPostgres", { connectionUri, templateDatabase: TEMPLATE_DATABASE });
  return async () => {
    await container.stop();
  };
};

export default startWarmPostgres;

/** The warm cluster this run was given, or `undefined` where there is none. */
const providedWarmPostgres = (): WarmPostgres | undefined => {
  try {
    return inject("warmPostgres");
  } catch {
    // `inject` reads Vitest's per-worker state, and outside a Vitest run — the browser
    // suite's served app, the local loop, the worker-view generator — there is none, so
    // the call throws rather than answering. Losing that error is safe because absence is
    // exactly what the caller is asking about: no warm cluster here, start your own.
    return undefined;
  }
};

/**
 * The database a file is named after: deterministic, so the same file's `beforeAll`
 * re-running inside one long-lived cluster asks for the same name every time. That is what
 * makes the drop-then-create below self-cleaning — under Stryker a covering file's hooks
 * re-run once per mutant, ~900 a worker, and a run that bails skips its `afterAll`, so a
 * fresh name each time would leave a database behind on every one of them.
 *
 * The digest is over the whole key, which keeps two files of the same basename in
 * different directories apart; the stem is kept in front of it so `\l` stays readable
 * while a run is stuck. Postgres truncates an identifier at 63 bytes and the longest this
 * yields is 56.
 */
const databaseNameFor = (databaseKey: string): string => {
  const stem = path
    .basename(databaseKey)
    .replaceAll(/[^a-z0-9]+/giu, "_")
    .toLowerCase();
  const digest = createHash("sha256").update(databaseKey).digest("hex").slice(0, 12);
  return `ba_${stem.slice(0, 40)}_${digest}`;
};

/** The file Vitest is running, which is the unit a fresh database belongs to. */
const runningTestFile = (): string => {
  const { testPath } = expect.getState();
  if (testPath === undefined) {
    throw new Error(
      "the warm harness was opened with no running test file to name a database after; pass a key",
    );
  }
  return testPath;
};

/**
 * One migrated Postgres for this test file — a `MigratedPostgres` exactly as
 * `startMigratedPostgres` returns, over a database copied from the run's migrated
 * template. Never a second migrate, never a second container.
 *
 * Where no warm cluster was provided the call falls back to `startMigratedPostgres`, so
 * the same line works under Playwright's served app, under the local loop and under a
 * plain `node` script.
 *
 * `stop()` closes this file's two pools, waits for their sessions to leave, and drops its
 * database; the container outlives it, and is stopped only when the Vitest instance closes.
 *
 * @param databaseKey what the database is named after. Defaults to the running test file,
 *   which is what a caller wants: one database per file, the same one on a re-run. A test
 *   proving that two databases are independent is the reason this can be said explicitly.
 */
export const openMigratedPostgres = async (databaseKey?: string): Promise<MigratedPostgres> => {
  const warm = providedWarmPostgres();
  if (warm === undefined) return startMigratedPostgres();

  const database = databaseNameFor(databaseKey ?? runningTestFile());
  await withAdmin(warm.connectionUri, async (admin) => {
    // `FORCE` because the leftover being dropped may still hold connections: the run that
    // made it bailed before its `afterAll`, and its pools' sockets outlive the module
    // registry Vitest resets between runs. Postgres 13 and later; the pinned image is 18.
    await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
    await admin.query(
      `CREATE DATABASE ${quoted(database)} TEMPLATE ${quoted(warm.templateDatabase)}`,
    );
  });
  return migratedPostgresOver(uriForDatabase(warm.connectionUri, database), async () => {
    await withAdmin(warm.connectionUri, async (admin) => {
      await untilSessionsGone(admin, database);
      // Still `FORCE`: a session that outstayed the wait is dropped with the database.
      await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
    });
  });
};
