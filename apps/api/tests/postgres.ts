import { type MigratedPostgres, openMigratedPostgres } from "@better-answers/schema/testing";
import type { Pool } from "pg";

/**
 * The factory every data-touching test builds its state through (`[TEST4]`): a real
 * Postgres, never a mock (`[TEST2]`), on the one pinned platform image, with the whole
 * journal applied (`@better-answers/schema/testing`'s harness — one harness for the
 * tier, `[APP3]`). The app is handed the runtime pool, so every request it serves
 * meets the same RLS a deployed estate does.
 *
 * This is the one line in `apps/api` that decides where that Postgres comes from. Under
 * Vitest it is a database copied from the template the run's `globalSetup` migrated, so
 * this tier's data files share one container instead of one per data file; outside Vitest
 * — Playwright's served app in `serve.ts`, the local loop in `local.ts` — the same call
 * starts a container of its own. Neither caller had to learn the difference.
 */

export type TestDatabase = {
  /** What the app connects as: `app_rt`, RLS applied. */
  readonly pool: Pool;
  /** The cluster's superuser — for seeding and catalogue reads only. */
  readonly superuser: Pool;
  stop: () => Promise<void>;
};

export async function startTestDatabase(): Promise<TestDatabase> {
  const migrated: MigratedPostgres = await openMigratedPostgres();
  return {
    pool: migrated.runtimePool,
    superuser: migrated.pool,
    stop: () => migrated.stop(),
  };
}
