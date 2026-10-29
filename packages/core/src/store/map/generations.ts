import type { PlatformPrincipal } from "../../kernel/index.ts";
import { existingLiveGen, type Tx } from "./write.ts";

export type MapCounts = {
  readonly liveGen: number | null;
  readonly nodes: Readonly<Record<string, number>>;
  readonly edges: Readonly<Record<string, number>>;
};

const countsStatement = (table: "map_node" | "map_edge"): string =>
  `SELECT label, count(*)::int AS count
     FROM ${table}
    WHERE workspace_id = $1 AND (gen IS NULL OR gen = $2::int)
    GROUP BY label
    ORDER BY label`;

const COUNT_NODES = countsStatement("map_node");
const COUNT_EDGES = countsStatement("map_edge");

const countsOf = async (
  statement: string,
  tx: Tx,
  workspaceId: string,
  liveGen: number | null,
): Promise<Record<string, number>> => {
  const found = await tx.query<{ label: string; count: number }>(statement, [workspaceId, liveGen]);
  return Object.fromEntries(found.rows.map((row) => [row.label, row.count]));
};

export const countMap = async (
  platform: PlatformPrincipal,
  tx: Tx,
  workspaceId: string,
): Promise<MapCounts> => {
  const liveGen = await existingLiveGen(workspaceId, tx);
  return {
    liveGen,
    nodes: await countsOf(COUNT_NODES, tx, workspaceId, liveGen),
    edges: await countsOf(COUNT_EDGES, tx, workspaceId, liveGen),
  };
};

export type SweptGeneration = {
  readonly gen: number;
  readonly nodes: number;
  readonly edges: number;
  readonly unresolved: number;
};

const SWEEP = `WITH live AS (
    SELECT live_gen FROM map_generation WHERE workspace_id = $1
  ),
  swept_nodes AS (
    DELETE FROM map_node
     WHERE workspace_id = $1 AND gen IS NOT NULL AND gen <> (SELECT live_gen FROM live)
    RETURNING gen
  ),
  swept_edges AS (
    DELETE FROM map_edge
     WHERE workspace_id = $1 AND gen IS NOT NULL AND gen <> (SELECT live_gen FROM live)
    RETURNING gen
  ),
  swept_unresolved AS (
    DELETE FROM map_unresolved_reference
     WHERE workspace_id = $1 AND gen <> (SELECT live_gen FROM live)
    RETURNING gen
  ),
  counted AS (
    SELECT gen, count(*)::int AS nodes, 0 AS edges, 0 AS unresolved FROM swept_nodes GROUP BY gen
    UNION ALL
    SELECT gen, 0 AS nodes, count(*)::int AS edges, 0 AS unresolved FROM swept_edges GROUP BY gen
    UNION ALL
    SELECT gen, 0 AS nodes, 0 AS edges, count(*)::int AS unresolved
      FROM swept_unresolved GROUP BY gen
  )
  SELECT gen, sum(nodes)::int AS nodes, sum(edges)::int AS edges,
         sum(unresolved)::int AS unresolved
    FROM counted
   GROUP BY gen
   ORDER BY gen`;

export const sweepNonLiveGenerations = async (
  platform: PlatformPrincipal,
  tx: Tx,
  workspaceId: string,
): Promise<readonly SweptGeneration[]> => {
  const swept = await tx.query<SweptGeneration>(SWEEP, [workspaceId]);
  return swept.rows;
};
