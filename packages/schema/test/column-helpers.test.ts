import { beforeAll, describe, expect, it } from "vitest";

import { listed } from "../src/column-helpers.ts";
import type { MigratedPostgres } from "./support/harness.ts";
import { openMigratedPostgres } from "./support/warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

const LISTED = ["it's", "plain", "''"];

const isListed = async (value: string): Promise<boolean | undefined> => {
  const { rows } = await db.pool.query<{ inside: boolean }>(
    `SELECT $1::text IN (${listed(LISTED)}) AS inside`,
    [value],
  );
  return rows[0]?.inside;
};

describe("an IN list of SQL string literals", () => {
  it.each(LISTED)("holds %j as the value itself", async (value) => {
    expect(await isListed(value)).toBe(true);
  });

  it.each(["it", "s", "'"])("leaves %j out of it", async (value) => {
    expect(await isListed(value)).toBe(false);
  });
});
