import type pg from "pg";

import { CONCEPT_NODE_LABEL, type ConceptIri } from "@better-answers/schema";

import { readableClause, readableParameters } from "../../access/index.ts";
import type { UserPrincipal } from "../../kernel/index.ts";
import type { Tx } from "./write.ts";

export type WalkStep = {
  readonly uid: string;
  readonly label: string;
  readonly kind: string | null;
  readonly depth: number;
};

export const MAP_WALK_DEPTH = 4;

const MAP_WALK_ROW_LIMIT = 1_000;

const MAP_WALK_TIMEOUT_MS = 2_000;

const insideClause = (alias: string): string =>
  `AND (${alias}.label <> '${CONCEPT_NODE_LABEL}' OR ${alias}.uid IN (
       SELECT filed.iri FROM concept_index filed
        WHERE filed.workspace_id = $1 AND filed.collection = ANY($5::text[])))`;

type Narrowing = { readonly seed: string; readonly hop: string; readonly answered: string };

const WHOLE: Narrowing = { seed: "", hop: "", answered: "" };

const CONCEPTS_ANSWERED = `WHERE label = '${CONCEPT_NODE_LABEL}'`;

const CONCEPTS: Narrowing = { seed: "", hop: "", answered: CONCEPTS_ANSWERED };

const INSIDE: Narrowing = {
  seed: insideClause("n"),
  hop: insideClause("m"),
  answered: CONCEPTS_ANSWERED,
};

const NEAREST = `nearest AS MATERIALIZED (
    SELECT uid, label, kind, min(depth) AS depth
      FROM walk
     GROUP BY uid, label, kind
  )`;

const walkStatement = (outward: boolean, narrowing: Narrowing = WHOLE): string => {
  const [source, sink] = outward ? ["from_uid", "to_uid"] : ["to_uid", "from_uid"];
  return `WITH RECURSIVE live AS (
    SELECT live_gen FROM map_generation WHERE workspace_id = $1
  ),
  walk AS (
    SELECT n.uid, n.label, n.kind, 0 AS depth
      FROM map_node n
      JOIN live ON n.gen IS NULL OR n.gen = live.live_gen
     WHERE n.workspace_id = $1 AND n.uid = ANY($2::text[])
       AND ${readableClause("n", 3)}
       ${narrowing.seed}
    UNION
    SELECT m.uid, m.label, m.kind, w.depth + 1
      FROM walk w
      JOIN map_edge e ON e.workspace_id = $1 AND e.${source} = w.uid
      JOIN live edge_live ON e.gen IS NULL OR e.gen = edge_live.live_gen
      JOIN map_node m ON m.workspace_id = $1 AND m.uid = e.${sink}
      JOIN live node_live ON m.gen IS NULL OR m.gen = node_live.live_gen
     WHERE w.depth < ${MAP_WALK_DEPTH}
       AND ${readableClause("e", 3)}
       AND ${readableClause("m", 3)}
       ${narrowing.hop}
  ),
  ${NEAREST}
  SELECT uid, label, kind, depth
    FROM nearest
   ${narrowing.answered}
   ORDER BY depth, uid
   LIMIT ${MAP_WALK_ROW_LIMIT}`;
};

type PreparedWalk = { readonly statement: string; readonly binds: readonly (readonly string[])[] };

const WALK_FROM: PreparedWalk = { statement: walkStatement(true), binds: [] };
const WALK_TO: PreparedWalk = { statement: walkStatement(false), binds: [] };
const WALK_CONCEPTS_FROM: PreparedWalk = { statement: walkStatement(true, CONCEPTS), binds: [] };
const WALK_FROM_INSIDE = walkStatement(true, INSIDE);

const conceptWalkOutOf = (collections: readonly string[] | undefined): PreparedWalk =>
  collections === undefined
    ? WALK_CONCEPTS_FROM
    : { statement: WALK_FROM_INSIDE, binds: [collections] };

const walk = async (
  { statement, binds }: PreparedWalk,
  principal: UserPrincipal,
  tx: Tx,
  uids: readonly string[],
): Promise<readonly WalkStep[]> => {
  await tx.query("SELECT set_config('statement_timeout', $1, true)", [String(MAP_WALK_TIMEOUT_MS)]);
  const found = await tx.query<WalkStep>(statement, [
    principal.workspaceId,
    uids,
    ...readableParameters(principal),
    ...binds,
  ]);
  return found.rows;
};

export const walkFromEntries = (
  principal: UserPrincipal,
  tx: Tx,
  uids: readonly ConceptIri[],
): Promise<readonly WalkStep[]> => walk(WALK_FROM, principal, tx, uids);

export const walkConceptsFromEntries = (
  principal: UserPrincipal,
  tx: Tx,
  uids: readonly ConceptIri[],
  collections?: readonly string[],
): Promise<readonly WalkStep[]> => walk(conceptWalkOutOf(collections), principal, tx, uids);

const WALK_TIMED_OUT = "57014";

export const walkTimedOut = (error: Error): boolean =>
  "code" in error && error.code === WALK_TIMED_OUT;

export const analyseMap = async (pool: pg.Pool): Promise<void> => {
  await pool.query("SELECT analyse_map()");
};

export const walkToEntries = (
  principal: UserPrincipal,
  tx: Tx,
  uids: readonly string[],
): Promise<readonly WalkStep[]> => walk(WALK_TO, principal, tx, uids);

export const walkFrom = (
  principal: UserPrincipal,
  tx: Tx,
  uid: ConceptIri,
): Promise<readonly WalkStep[]> => walkFromEntries(principal, tx, [uid]);

export const walkTo = (
  principal: UserPrincipal,
  tx: Tx,
  uid: string,
): Promise<readonly WalkStep[]> => walkToEntries(principal, tx, [uid]);
