import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { migrationsFolder } from "../src/index.ts";
import { POSTGRES_IMAGE } from "../src/postgres-image.ts";

/**
 * The one Testcontainers harness (`[TEST2]`): the pinned image, the whole journal
 * applied, a superuser pool handed back. Every data test in this package — the RLS
 * proofs, the parity test, the worker-view drift test — reuses this; none starts its
 * own container its own way. RLS assertions run `SET LOCAL ROLE app_rt` inside a
 * transaction, because the container's superuser bypasses RLS by design.
 *
 * `runtimePool` is the app's footing: every connection it hands out has already
 * `SET ROLE app_rt`, so a test that drives the app through it meets the same RLS a
 * deployed estate does (where the DSN itself is the runtime role, ADR 0032).
 *
 * There are two ways to one of these. `startMigratedPostgres` is the cold one — a
 * container of its own, migrated in place — and is what a caller outside a Vitest run
 * gets. `openMigratedPostgres` in `./warm-postgres.ts` is the warm one, a database
 * copied from the template that run's `globalSetup` migrated once. Both hand back this
 * same shape, so a suite reads its database the same way whichever started it.
 */
export type MigratedPostgres = {
  /** The container's superuser — bypasses RLS; for seeding and catalogue reads. */
  readonly pool: pg.Pool;
  /** The runtime role — what the app connects as; RLS applies. */
  readonly runtimePool: pg.Pool;
  readonly stop: () => Promise<void>;
};

/** The whole drizzle journal, applied through `pool` — the only place either path migrates. */
export const applyJournal = async (pool: pg.Pool): Promise<void> => {
  await migrate(drizzle(pool), { migrationsFolder });
};

/**
 * The pair of pools a caller receives over a migrated database, and the `stop` that closes
 * them before `release` disposes of whatever holds it — a container on the cold path, one
 * copied database on the warm one. Written once here so neither path grows its own pool
 * settings or its own idea of what `app_rt` costs.
 */
export const migratedPostgresOver = (
  connectionUri: string,
  release: () => Promise<void>,
): MigratedPostgres => {
  const pool = new pg.Pool({ connectionString: connectionUri, max: 3 });
  // `app_rt` is NOLOGIN (migration 0000); the estate's provisioning gives it LOGIN, a
  // test connects as the superuser and takes the role at session start instead. As a
  // startup option the switch fails closed: a connection that cannot take the role is
  // refused by Postgres, never handed out as the superuser.
  const runtimePool = new pg.Pool({
    connectionString: connectionUri,
    max: 5,
    options: "-c role=app_rt",
  });
  return {
    pool,
    runtimePool,
    stop: async () => {
      await runtimePool.end();
      await pool.end();
      await release();
    },
  };
};

export const startMigratedPostgres = async (): Promise<MigratedPostgres> => {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const migrated = migratedPostgresOver(container.getConnectionUri(), async () => {
    await container.stop();
  });
  try {
    await applyJournal(migrated.pool);
  } catch (error) {
    await migrated.stop();
    throw error;
  }
  return migrated;
};

/** Run `fn` inside one rolled-back transaction — the data tests' default footing. */
export const withRollback = async <T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
};
