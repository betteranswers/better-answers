import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { migrationsFolder } from "../src/index.ts";
import { POSTGRES_IMAGE } from "../src/postgres-image.ts";

export const POSTGRES_COMMAND = [
  "postgres",
  "-c",
  "fsync=off",
  "-c",
  "synchronous_commit=off",
  "-c",
  "full_page_writes=off",
] as const;

export type MigratedPostgres = {
  readonly pool: pg.Pool;

  readonly runtimePool: pg.Pool;

  readonly connectionUri: string;
  readonly stop: () => Promise<void>;
};

export const applyJournal = async (pool: pg.Pool): Promise<void> => {
  await migrate(drizzle(pool), { migrationsFolder });
};

export const migratedPostgresOver = (
  connectionUri: string,
  release: () => Promise<void>,
): MigratedPostgres => {
  const pool = new pg.Pool({ connectionString: connectionUri, max: 3 });

  const runtimePool = new pg.Pool({
    connectionString: connectionUri,
    max: 5,
    options: "-c role=app_rt",
  });
  return {
    pool,
    runtimePool,
    connectionUri,
    stop: async () => {
      await runtimePool.end();
      await pool.end();
      await release();
    },
  };
};

export const startMigratedPostgres = async (): Promise<MigratedPostgres> => {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand([...POSTGRES_COMMAND])
    .start();
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
