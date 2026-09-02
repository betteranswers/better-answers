import { type MigratedPostgres, startMigratedPostgres } from "@better-answers/schema/testing";
import type { Pool } from "pg";

/**
 * The factory every data-touching test builds its state through (`[TEST4]`): a real
 * Postgres, never a mock (`[TEST2]`), on the one pinned platform image, with the whole
 * journal applied (`@better-answers/schema/testing`'s harness — one harness for the
 * tier, `[APP3]`). The app is handed the runtime pool, so every request it serves
 * meets the same RLS a deployed estate does.
 */

export type TestDatabase = {
  /** What the app connects as: `app_rt`, RLS applied. */
  readonly pool: Pool;
  /** The container's superuser — for seeding and catalogue reads only. */
  readonly superuser: Pool;
  stop: () => Promise<void>;
};

export async function startTestDatabase(): Promise<TestDatabase> {
  const migrated: MigratedPostgres = await startMigratedPostgres();
  return {
    pool: migrated.runtimePool,
    superuser: migrated.pool,
    stop: () => migrated.stop(),
  };
}
