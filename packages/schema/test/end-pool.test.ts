import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { endPool, type MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

describe("ending a pool before its database goes away", () => {
  it("resolves once every pool client's connection has closed", async () => {
    const pool = new pg.Pool({ connectionString: db.connectionUri, max: 2 });
    const closed: boolean[] = [];
    pool.on("connect", (client) => {
      const index = closed.push(false) - 1;
      client.once("end", () => {
        closed[index] = true;
      });
    });
    const held = await Promise.all([pool.connect(), pool.connect()]);
    for (const client of held) client.release();

    await endPool(pool);

    expect(closed).toEqual([true, true]);
  });

  it("resolves at once for a pool that never connected", async () => {
    const pool = new pg.Pool({ connectionString: db.connectionUri });

    await expect(endPool(pool)).resolves.toBeUndefined();
  });
});
