import type { Pool } from "pg";

import { type MigratedPostgres, openMigratedPostgres } from "@better-answers/schema/testing";

export type TestDatabase = {
  readonly pool: Pool;

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
