import type { Pool } from "pg";

import { type MigratedPostgres, openMigratedPostgres } from "@better-answers/schema/testing";

export type TestDatabase = {
  /** Connects as the api's runtime role, so row-level security holds. */
  readonly pool: Pool;

  /** Connects past row-level security, to seed and inspect behind the api's back. */
  readonly superuser: Pool;

  readonly connectionUri: string;
  stop: () => Promise<void>;
};

export async function startTestDatabase(): Promise<TestDatabase> {
  const migrated: MigratedPostgres = await openMigratedPostgres();
  return {
    pool: migrated.runtimePool,
    superuser: migrated.pool,
    connectionUri: migrated.connectionUri,
    stop: () => migrated.stop(),
  };
}
