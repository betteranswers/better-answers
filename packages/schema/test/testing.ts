/**
 * `@better-answers/schema/testing` — the harness (`[TEST2]`) and the factory
 * (`[TEST4]`) every data test in the TypeScript tier reuses.
 */
export { type MigratedPostgres, startMigratedPostgres, withRollback } from "./harness.ts";
export { type TestData, testData } from "./factory.ts";
// The minter is not re-exported here: it is production code, and a test that needs one
// takes it from `@better-answers/schema` beside everything else the package exports.
