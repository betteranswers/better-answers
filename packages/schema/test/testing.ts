/**
 * `@better-answers/schema/testing` — the harness (`[TEST2]`) and the factory
 * (`[TEST4]`) every data test in the TypeScript tier reuses.
 *
 * The harness has two paths to the same `MigratedPostgres`: `openMigratedPostgres`, the
 * warm one, which copies a database from the template that run's `globalSetup` migrated,
 * and `startMigratedPostgres`, the cold one, a container of its own. The `globalSetup` a
 * workspace's Vitest config registers is the package's own entry,
 * `@better-answers/schema/testing/warm-postgres`, so no workspace keeps a copy of it.
 */
export { type MigratedPostgres, startMigratedPostgres, withRollback } from "./harness.ts";
export { openMigratedPostgres, type WarmPostgres } from "./warm-postgres.ts";
export { type TestData, testData } from "./factory.ts";
export { CONFIGURED_LLM_ROUTES, LISTED_LLM_ROUTES } from "./llm-route-scenario.ts";
// The minter is not re-exported here: it is production code, and a test that needs one
// takes it from `@better-answers/schema` beside everything else the package exports.
