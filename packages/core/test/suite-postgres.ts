import { type MigratedPostgres, startMigratedPostgres } from "@better-answers/schema/testing";
import { afterAll, beforeAll } from "vitest";

/**
 * One migrated Postgres for a suite, started once and stopped once — the arrange block every
 * data suite in this package opens with, written once here.
 *
 * The shape is `apps/api/tests/suite-app.ts`'s `appForSuite`: the helper registers the
 * lifecycle and hands back an accessor, so a suite says what it needs on its first line and
 * reads the database from a call rather than from a `let` it has to remember is assigned.
 * It became a helper when a second suite wanted the same footing and the copy gate said so;
 * a suite still carrying its own is one no ticket has touched since.
 */
export const postgresForSuite = (): (() => MigratedPostgres) => {
  let db: MigratedPostgres | undefined;

  beforeAll(async () => {
    db = await startMigratedPostgres();
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  return () => {
    // Reached only from a test body, which runs after `beforeAll`; the throw is what a
    // caller gets instead of `undefined` if that ever stops being true.
    if (db === undefined) throw new Error("the suite's Postgres was read before it started");
    return db;
  };
};
