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
 */
export type MigratedPostgres = {
  readonly pool: pg.Pool;
  readonly stop: () => Promise<void>;
};

export const startMigratedPostgres = async (): Promise<MigratedPostgres> => {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 3 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } catch (error) {
    await pool.end();
    await container.stop();
    throw error;
  }
  return {
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
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
