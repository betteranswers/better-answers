import type pg from "pg";
import { describe, expect, it } from "vitest";

import { MARK_THE_MATCH_LEAKPROOF } from "../src/index.ts";
import { withRollback } from "./harness.ts";
import { matchIsLeakproof, postgresForSuite, refusesEach, UNMARK_THE_MATCH } from "./probes.ts";

const db = postgresForSuite();

const leakproofFunctions = async (client: pg.PoolClient): Promise<readonly string[]> => {
  const read = await client.query<{ signature: string }>(
    "SELECT oid::regprocedure::text AS signature FROM pg_catalog.pg_proc WHERE proleakproof ORDER BY 1",
  );
  return read.rows.map((row) => row.signature);
};

describe("the full-text match `find` filters a chunk by", () => {
  it("is leakproof once migrated as a deploy migrates", async () => {
    await withRollback(db().pool, async (client) => {
      expect(await matchIsLeakproof(client)).toBe(true);
    });
  });

  it("is marked again after a restore, and twice changes nothing", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(UNMARK_THE_MATCH);
      const restored = await matchIsLeakproof(client);

      await client.query(MARK_THE_MATCH_LEAKPROOF);
      const marked = await matchIsLeakproof(client);
      await client.query(MARK_THE_MATCH_LEAKPROOF);

      expect({ restored, marked, again: await matchIsLeakproof(client) }).toEqual({
        restored: false,
        marked: true,
        again: true,
      });
    });
  });

  it("is the only function migrate's mark changes", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(UNMARK_THE_MATCH);
      const before = await leakproofFunctions(client);

      await client.query(MARK_THE_MATCH_LEAKPROOF);
      const after = await leakproofFunctions(client);

      expect({
        marked: after.filter((signature) => !before.includes(signature)),
        unmarked: before.filter((signature) => !after.includes(signature)),
      }).toEqual({ marked: ["ts_match_vq(tsvector,tsquery)"], unmarked: [] });
    });
  });

  it("is refused to both runtime roles, and the mark stands", async () => {
    await withRollback(db().pool, async (client) => {
      for (const role of ["app_rt", "worker_rt"]) {
        await client.query("RESET ROLE");
        await client.query(`SET LOCAL ROLE ${role}`);
        await refusesEach(client, [
          [MARK_THE_MATCH_LEAKPROOF, `${role} marking the match leakproof`, [], /must be owner/],
          [UNMARK_THE_MATCH, `${role} taking the mark off the match`, [], /must be owner/],
        ]);
      }
      await client.query("RESET ROLE");

      expect(await matchIsLeakproof(client)).toBe(true);
    });
  });
});
