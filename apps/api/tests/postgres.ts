import { POSTGRES_IMAGE } from "@better-answers/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";

/**
 * The factory every data-touching test builds its state through (`[TEST4]`): a real
 * Postgres, never a mock (`[TEST2]`), on the one pinned platform image (ADR 0032 —
 * `packages/schema/src/postgres-image.ts`).
 */

export type TestDatabase = {
  readonly pool: Pool;
  stop: () => Promise<void>;
};

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });

  return {
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
