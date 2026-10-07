import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { MARK_THE_MATCH_LEAKPROOF, migrationsFolder } from "../src/index.ts";
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
  /** Connects as the superuser, whom no policy binds. */
  readonly pool: pg.Pool;

  /** Connects as `app_rt`, the api's role, which every policy binds. */
  readonly runtimePool: pg.Pool;

  readonly connectionUri: string;
  readonly stop: () => Promise<void>;
};

export const migrateAsDeployed = async (pool: pg.Pool): Promise<void> => {
  await migrate(drizzle(pool), { migrationsFolder });
  await pool.query(MARK_THE_MATCH_LEAKPROOF);
};

/**
 * `pool.end()` resolves before its sockets close; a database stopped in that gap sends 57P01,
 * which the pool re-emits unheard, failing the run.
 */
export const endPool = async (pool: pg.Pool): Promise<void> => {
  let open = pool.totalCount;
  const closed = new Promise<void>((resolve) => {
    if (open === 0) resolve();
    pool.on("remove", () => {
      open -= 1;
      if (open === 0) resolve();
    });
  });
  await pool.end();
  await closed;
};

/** Migrates nothing: opens both pools over `connectionUri`; `stop` ends them, then `release`. */
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
      await endPool(runtimePool);
      await endPool(pool);
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
    await migrateAsDeployed(migrated.pool);
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

/** As `withRollback`, but keeps what `fn` wrote for the cases after it. */
export const withCommit = async (
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/** An act's transaction that has written to the audit log and not yet committed. */
export const whileAnAuditWriteIsOpen = async <T>(
  pool: pg.Pool,
  work: () => Promise<T>,
): Promise<T> => {
  const writer = await pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("LOCK TABLE audit_event IN ROW EXCLUSIVE MODE");
    return await work();
  } finally {
    await writer.query("ROLLBACK");
    writer.release();
  }
};
