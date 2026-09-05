/**
 * `@better-answers/schema/testing` — the harness (`[TEST2]`) and the factory
 * (`[TEST4]`) every data test in the TypeScript tier reuses.
 */
export { type MigratedPostgres, startMigratedPostgres, withRollback } from "./harness.ts";
export { type TestData, testData } from "./factory.ts";
// The production minter, so a test seeds ids in exactly the shape the platform mints.
export { ulid } from "../src/index.ts";
