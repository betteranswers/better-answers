import type pg from "pg";
import { beforeAll, expect } from "vitest";

import { type MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

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

const constraintOf = (error: unknown): string => {
  const named =
    typeof error === "object" && error !== null && "constraint" in error
      ? error.constraint
      : undefined;

  return typeof named === "string" ? named : `nothing named a constraint: ${String(error)}`;
};

export const ADMITTED = "admitted";

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

export type Refusal = readonly [
  statement: string,
  why: string,
  parameters?: readonly unknown[],
  message?: RegExp,
];

export const refusesEach = async (
  client: pg.PoolClient,
  refusals: readonly Refusal[],
): Promise<void> => {
  for (const [statement, why, parameters = [], message = /permission denied/] of refusals) {
    await client.query("SAVEPOINT refusal_probe");
    const outcome = await client
      .query(statement, [...parameters])
      .then(() => "allowed")
      .catch((cause: unknown) => (cause as { message: string }).message);
    expect({ why, outcome }).toEqual({
      why,
      outcome: expect.stringMatching(message),
    });
    await client.query("ROLLBACK TO SAVEPOINT refusal_probe");
  }
};
