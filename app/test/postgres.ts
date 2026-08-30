import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";

/**
 * The factory every data-touching test builds its state through (`[TEST4]`): a real
 * Postgres, never a mock (`[TEST2]`). B2 (`T-003`) swaps the image for the platform's
 * own — AGE plus pgvector on Postgres 18 (`deploy/postgres.Dockerfile`) — once there
 * is a schema to migrate into it.
 *
 * Image read from Docker Hub on 30/08/2026 (`[DEPS1]`).
 */
const POSTGRES_IMAGE = "postgres:18.6-trixie";

export type TestDatabase = {
  readonly pool: Pool;
  readonly connectionString: string;
  stop: () => Promise<void>;
};

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const connectionString = container.getConnectionUri();
  const pool = new Pool({ connectionString });

  return {
    pool,
    connectionString,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
