import type pg from "pg";
import { describe, expect, it } from "vitest";

import { ulid } from "../src/index.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite, refusesEach } from "./probes.ts";

const db = postgresForSuite();

const ANALYSE_THE_MAP = "SELECT public.analyse_map()";

const MAP_TABLES = ["map_edge", "map_node"] as const;

const NODES = 3;

const tablesWithStatistics = async (client: pg.PoolClient): Promise<readonly string[]> => {
  const read = await client.query<{ table: string }>(
    `SELECT DISTINCT tablename AS "table" FROM pg_stats
      WHERE schemaname = 'public' AND tablename = ANY($1::text[])
      ORDER BY tablename`,
    [[...MAP_TABLES]],
  );
  return read.rows.map((row) => row.table);
};

const aSmallMap = async (client: pg.PoolClient): Promise<void> => {
  const seed = testData(client);
  const workspace = await seed.workspace();
  const hub = await seed.mapNode({ workspaceId: workspace.id });
  for (let at = 1; at < NODES; at += 1) {
    const spoke = await seed.mapNode({ workspaceId: workspace.id });
    await seed.mapEdge({ workspaceId: workspace.id, fromUid: hub.uid, toUid: spoke.uid });
  }
};

const as = (client: pg.PoolClient, role: string): Promise<unknown> =>
  client.query(`SET LOCAL ROLE ${role}`);

describe("analysing the map for the planner", () => {
  it.each(["app_rt", "worker_rt"])("analyses both map tables when %s asks", async (role) => {
    await withRollback(db().pool, async (client) => {
      await aSmallMap(client);
      expect(await tablesWithStatistics(client), "before the call").toEqual([]);
      await as(client, role);

      await client.query(ANALYSE_THE_MAP);

      await client.query("RESET ROLE");
      expect(await tablesWithStatistics(client)).toEqual([...MAP_TABLES]);
    });
  });

  it("analyses nothing when a runtime role runs ANALYZE itself", async () => {
    await withRollback(db().pool, async (client) => {
      await aSmallMap(client);
      await as(client, "app_rt");

      await client.query("ANALYZE public.map_node, public.map_edge");

      await client.query("RESET ROLE");
      expect(await tablesWithStatistics(client)).toEqual([]);
    });
  });

  it("refuses every caller but the two runtime roles", async () => {
    await withRollback(db().pool, async (client) => {
      await aSmallMap(client);
      const stranger = `map_probe_${ulid().toLowerCase()}`;
      await client.query(`CREATE ROLE ${stranger} NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${stranger}`);
      await as(client, stranger);

      await refusesEach(client, [[ANALYSE_THE_MAP, "a role outside the two runtime roles"]]);

      await client.query("RESET ROLE");
      expect(await tablesWithStatistics(client)).toEqual([]);
    });
  });

  it("asks autovacuum to count the tables at one percent", async () => {
    const read = await db().pool.query<{ table: string; options: readonly string[] }>(
      `SELECT relname AS "table", reloptions AS options FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])
        ORDER BY relname`,
      [[...MAP_TABLES]],
    );
    expect(read.rows).toEqual(
      MAP_TABLES.map((table) => ({
        table,
        options: ["autovacuum_analyze_scale_factor=0.01", "autovacuum_analyze_threshold=50"],
      })),
    );
  });
});
