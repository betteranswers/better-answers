import { type MigratedPostgres, openMigratedPostgres } from "@better-answers/schema/testing";
import type { Pool } from "pg";

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
