import type pg from "pg";
import { beforeAll } from "vitest";

import { type MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

/**
 * What every data suite in this package does the same way: open the one migrated database for
 * the file, and ask the table what refused a statement.
 *
 * Written once because two suites doing it two ways is two places a probe could quietly stop
 * asserting — a refusal read as "it threw" rather than as *which rule refused it* passes just
 * as happily when the wrong rule fires. `packages/core/test/suite-postgres.ts` is the same
 * shape on the other side of the tree.
 */

/**
 * The migrated database this file runs against, opened once and closed by the teardown that
 * rides back from the hook that opened it — so the copy a suite runs against cannot outlive
 * the run that made it by way of an `afterAll` somebody moved. Answered as a function, because
 * the value does not exist until the hook has run.
 */
export const postgresForSuite = (): (() => MigratedPostgres) => {
  let opened: MigratedPostgres | undefined;
  beforeAll(async () => {
    opened = await openMigratedPostgres();
    return async () => {
      await opened?.stop();
    };
  });
  return () => {
    if (opened === undefined) throw new Error("the suite's database has not been opened");
    return opened;
  };
};

/**
 * The Postgres error's own `constraint`, which is the name the migration wrote — so a refusal
 * is asserted against the rule that refused it and not merely against "it threw".
 */
export const constraintOf = (error: unknown): string => {
  const named =
    typeof error === "object" && error !== null && "constraint" in error
      ? error.constraint
      : undefined;
  // A Postgres error carries the key whether or not a constraint refused the statement, so
  // anything that is not a name is read as *no rule refused this* — a malformed statement,
  // say — and answered with the error itself. Read as a name, an absent one would stringify
  // to "undefined", which is a refusal nobody could look up.
  return typeof named === "string" ? named : `nothing named a constraint: ${String(error)}`;
};

/** What `refusalOf` answers when the statement it ran was not refused at all. */
export const ADMITTED = "admitted";

/**
 * One attempt the table is asked about, answered with the constraint that refused it or with
 * `ADMITTED`. A failed statement aborts the transaction it happened in, so every attempt runs
 * against a savepoint it can come back to — which is what lets one test walk a whole word list
 * — and an admitted one is rolled back too, so the next probe starts from the same table.
 */
export const refusalOf = async (
  client: pg.PoolClient,
  attempt: () => Promise<unknown>,
): Promise<string> => {
  await client.query("SAVEPOINT probe");
  try {
    await attempt();
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT probe");
    return constraintOf(error);
  }
  await client.query("ROLLBACK TO SAVEPOINT probe");
  return ADMITTED;
};
