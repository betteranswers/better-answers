import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { POSTGRES_IMAGE } from "../../src/postgres-image.ts";
import { endPool, POSTGRES_COMMAND } from "../support/harness.ts";
import { migrationsFolderEndingAt } from "./journal-statements.ts";

export const inADatabaseMigratedTo = async (
  lastMigration: string,
  run: (pool: pg.Pool) => Promise<void>,
): Promise<void> => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand([...POSTGRES_COMMAND])
    .start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 2 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationsFolderEndingAt(lastMigration) });
    await run(pool);
  } finally {
    await endPool(pool);
    await container.stop();
  }
};
