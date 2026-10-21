import type pg from "pg";
import type { z } from "zod";

import {
  CONCEPT_DEPRECATED_STATUS,
  CONCEPT_NODE_LABEL,
  citedSourcesOf,
  type CitedSource,
  type ConceptIri,
  type conceptFrontmatter,
  DERIVED_FROM_LABEL,
  IRI,
  LINKS_TO_LABEL,
  resolvedResource,
  SUPERSEDES_LABEL,
} from "@better-answers/schema";
import { linksAndMarksOf, proseOf } from "@better-answers/schema/concept-file";

import { readableClause, readableParameters } from "../../access/index.ts";
import type { PlatformPrincipal, Principal, UserPrincipal } from "../../kernel/index.ts";
import { sectionAt, sentenceAt } from "./sentence.ts";

export { sectionAt, sentenceAt };

type Tx = Pick<pg.PoolClient, "query">;

type Frontmatter = z.infer<typeof conceptFrontmatter>;

type EdgeSource = {
  readonly workspaceId: string;
  readonly iri: string;
  readonly kind: string;
  readonly path: string;
  readonly body: string;

  readonly sources: readonly CitedSource[];
  readonly publishedAt: Date | null;
  readonly sensitivity: string;
  readonly audience: string;
  readonly audienceGroups: readonly string[] | null;
};

type ConceptIndexRow = Omit<EdgeSource, "sources"> & {
  readonly frontmatter: Frontmatter;
};

export type ConceptDelta = EdgeSource & {
  readonly status: string;
};

export type WalkStep = {
  readonly uid: string;
  readonly label: string;
  readonly kind: string | null;
  readonly depth: number;
};

export const MAP_WALK_DEPTH = 4;

const MAP_WALK_ROW_LIMIT = 1_000;

const MAP_WALK_TIMEOUT_MS = 2_000;

type OutgoingEdge = {
  readonly uid: string;
  readonly label: string;
  readonly toUid: string;
  readonly toKind: string | null;
  readonly section: string | null;
  readonly sentence: string | null;
};

type OutgoingRef = {
  readonly relation: "link" | "lineage";
  readonly ordinal: number;
  readonly target: Readonly<{ iri: string } | { path: string }>;
  readonly section: string | null;
  readonly sentence: string | null;
};

export const targetOf = (raw: string, from: string): OutgoingRef["target"] | undefined => {
  const bare = raw.split("#")[0] ?? "";
  if (bare === "") return undefined;
  if (IRI.test(bare)) return { iri: bare };

  if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("//")) return undefined;
  return { path: resolvedResource(bare, from).slice(1) };
};

const referencesOf = (concept: EdgeSource): readonly OutgoingRef[] => {
  const prose = proseOf(concept.body);
  const links = linksAndMarksOf(concept.body, concept.sources).links.flatMap((link) => {
    const target = targetOf(link.target, concept.path);
    if (target === undefined) return [];
    return [
      {
        relation: "link" as const,
        ordinal: link.ordinal,
        target,
        section: sectionAt(prose, link.at),

        sentence: sentenceAt(prose, link.at),
      },
    ];
  });

  const lineage = concept.sources.flatMap((cited, ordinal) => {
    const target = targetOf(cited.resource, concept.path);
    if (target === undefined) return [];
    return [{ relation: "lineage" as const, ordinal, target, section: null, sentence: null }];
  });

  return [...links, ...lineage];
};

type ResolvedTarget = {
  readonly iri: string;
  readonly kind: string | null;
  readonly status: string | null;
};

type ResolvedRow = {
  readonly iri: string;
  readonly kind: string;
  readonly status: string;
  readonly path: string;
};

const supersedes = (target: ResolvedTarget, fromKind: string): boolean =>
  target.status === CONCEPT_DEPRECATED_STATUS && target.kind === fromKind;

const resolveOutgoing = async (tx: Tx, concept: EdgeSource): Promise<readonly OutgoingEdge[]> => {
  const workspaceId = concept.workspaceId;
  const references = referencesOf(concept);
  const paths = [
    ...new Set(references.flatMap((ref) => ("path" in ref.target ? [ref.target.path] : []))),
  ];
  const iris = [
    ...new Set(references.flatMap((ref) => ("iri" in ref.target ? [ref.target.iri] : []))),
  ];

  const byPath = new Map<string, ResolvedTarget>();

  if (paths.length > 0) {
    const found = await tx.query<ResolvedRow>(
      "SELECT iri, kind, status, path FROM concept_index WHERE workspace_id = $1 AND path = ANY($2::text[])",
      [workspaceId, paths],
    );
    for (const row of found.rows) {
      byPath.set(row.path, { iri: row.iri, kind: row.kind, status: row.status });
    }
  }
  const byIri = new Map<string, ResolvedTarget>();

  if (iris.length > 0) {
    const found = await tx.query<ResolvedRow>(
      "SELECT iri, kind, status, path FROM concept_index WHERE workspace_id = $1 AND iri = ANY($2::text[])",
      [workspaceId, iris],
    );
    for (const row of found.rows) {
      byIri.set(row.iri, { iri: row.iri, kind: row.kind, status: row.status });
    }
  }

  const cited = new Set<string>();
  return references.flatMap((ref) => {
    const resolved =
      "iri" in ref.target
        ? (byIri.get(ref.target.iri) ?? { iri: ref.target.iri, kind: null, status: null })
        : byPath.get(ref.target.path);
    if (resolved === undefined) return [];
    if (ref.relation === "lineage") {
      if (cited.has(resolved.iri)) return [];
      cited.add(resolved.iri);
      return [
        {
          uid: `lineage:${concept.iri}:${ref.ordinal}`,
          label: supersedes(resolved, concept.kind) ? SUPERSEDES_LABEL : DERIVED_FROM_LABEL,
          toUid: resolved.iri,
          toKind: null,
          section: null,
          sentence: null,
        },
      ];
    }
    return [
      {
        uid: `links_to:${concept.iri}:${ref.ordinal}`,
        label: LINKS_TO_LABEL,
        toUid: resolved.iri,
        toKind: resolved.kind,
        section: ref.section,
        sentence: ref.sentence,
      },
    ];
  });
};

const DERIVED_EDGE_LABELS = [LINKS_TO_LABEL, SUPERSEDES_LABEL, DERIVED_FROM_LABEL];

const replaceOutgoingEdges = async (gen: number, tx: Tx, concept: EdgeSource): Promise<void> => {
  const workspaceId = concept.workspaceId;
  const edges = await resolveOutgoing(tx, concept);
  await tx.query(
    `DELETE FROM map_edge
      WHERE workspace_id = $1 AND gen = $2 AND from_uid = $3 AND label = ANY($4::text[])`,
    [workspaceId, gen, concept.iri, DERIVED_EDGE_LABELS],
  );
  for (const edge of edges) {
    await tx.query(
      `INSERT INTO map_edge (workspace_id, gen, uid, label, from_uid, to_uid, from_kind,
                               to_kind, section, sentence, published_at, sensitivity, audience,
                               audience_groups)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        workspaceId,
        gen,
        edge.uid,
        edge.label,
        concept.iri,
        edge.toUid,
        edge.label === LINKS_TO_LABEL ? concept.kind : null,
        edge.toKind,
        edge.section,
        edge.sentence,
        concept.publishedAt,
        concept.sensitivity,
        concept.audience,
        concept.audienceGroups,
      ],
    );
  }
};

const namePattern = (filename: string): string =>
  `(^|[\\s"'(<:/[])${filename.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`;

const liveGeneration = async (workspaceId: string, tx: Tx): Promise<number> => {
  const row = await tx.query<{ live_gen: number }>(
    `INSERT INTO map_generation (workspace_id, live_gen) VALUES ($1, 1)
     ON CONFLICT (workspace_id) DO UPDATE SET live_gen = map_generation.live_gen
     RETURNING live_gen`,
    [workspaceId],
  );

  const liveGen = row.rows[0]?.live_gen;
  if (liveGen === undefined) throw new Error("the live generation could not be read");
  return liveGen;
};

const existingLiveGen = async (workspaceId: string, tx: Tx): Promise<number | null> => {
  const live = await tx.query<{ live_gen: number }>(
    "SELECT live_gen FROM map_generation WHERE workspace_id = $1",
    [workspaceId],
  );
  return live.rows[0]?.live_gen ?? null;
};

export const writeConceptDelta = async (
  principal: Principal,
  tx: Tx,
  delta: ConceptDelta,
): Promise<void> => {
  const workspaceId = delta.workspaceId;
  const gen = await liveGeneration(workspaceId, tx);

  const mapped = await tx.query(
    "SELECT 1 FROM map_node WHERE workspace_id = $1 AND gen = $2 AND uid = $3",
    [workspaceId, gen, delta.iri],
  );
  const isNew = mapped.rowCount === 0;

  await tx.query(
    `INSERT INTO map_node (workspace_id, gen, uid, label, kind, published_at, sensitivity,
                             audience, audience_groups)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, gen, uid) WHERE gen IS NOT NULL
     DO UPDATE SET kind = EXCLUDED.kind, published_at = EXCLUDED.published_at,
                   sensitivity = EXCLUDED.sensitivity, audience = EXCLUDED.audience,
                   audience_groups = EXCLUDED.audience_groups`,
    [
      workspaceId,
      gen,
      delta.iri,
      CONCEPT_NODE_LABEL,
      delta.kind,
      delta.publishedAt,
      delta.sensitivity,
      delta.audience,
      delta.audienceGroups,
    ],
  );
  await tx.query(
    `UPDATE map_edge SET to_kind = $4
      WHERE workspace_id = $1 AND gen = $2 AND label = '${LINKS_TO_LABEL}' AND to_uid = $3
        AND to_kind IS DISTINCT FROM $4`,
    [workspaceId, gen, delta.iri, delta.kind],
  );

  await tx.query(
    `UPDATE map_edge SET label = CASE
        WHEN $4 AND EXISTS (SELECT 1 FROM map_node n
                             WHERE n.workspace_id = $1 AND n.gen = $2
                               AND n.uid = map_edge.from_uid AND n.kind = $5)
        THEN '${SUPERSEDES_LABEL}' ELSE '${DERIVED_FROM_LABEL}' END
      WHERE workspace_id = $1 AND gen = $2 AND to_uid = $3
        AND label IN ('${SUPERSEDES_LABEL}', '${DERIVED_FROM_LABEL}')`,
    [workspaceId, gen, delta.iri, delta.status === CONCEPT_DEPRECATED_STATUS, delta.kind],
  );
  await replaceOutgoingEdges(gen, tx, delta);

  if (!isNew) return;

  const naming = await tx.query<ConceptIndexRow>(
    `SELECT workspace_id AS "workspaceId", iri, kind, path, body, frontmatter,
            published_at AS "publishedAt", sensitivity, audience,
            audience_groups AS "audienceGroups"
       FROM concept_index
      WHERE workspace_id = $1 AND iri <> $2 AND (body ~ $3 OR frontmatter::text ~ $3)`,
    [workspaceId, delta.iri, namePattern(delta.path.split("/").at(-1) ?? delta.path)],
  );

  for (const { frontmatter, ...row } of naming.rows) {
    await replaceOutgoingEdges(gen, tx, {
      ...row,
      sources: citedSourcesOf(frontmatter["sources"]),
    });
  }
};

export type ConceptVisibility = {
  readonly workspaceId: string;
  readonly iri: string;
  readonly sensitivity: string;
  readonly audience: string;
  readonly audienceGroups: readonly string[] | null;
};

export const writeConceptVisibility = async (
  principal: Principal,
  tx: Tx,
  visibility: ConceptVisibility,
): Promise<void> => {
  const gen = await existingLiveGen(visibility.workspaceId, tx);
  if (gen === null) return;
  const columns = [
    visibility.workspaceId,
    gen,
    visibility.iri,
    visibility.sensitivity,
    visibility.audience,
    visibility.audienceGroups,
  ];
  await tx.query(
    `UPDATE map_node SET sensitivity = $4, audience = $5, audience_groups = $6
      WHERE workspace_id = $1 AND gen = $2 AND uid = $3`,
    columns,
  );
  await tx.query(
    `UPDATE map_edge SET sensitivity = $4, audience = $5, audience_groups = $6
      WHERE workspace_id = $1 AND gen = $2 AND from_uid = $3 AND label = ANY($7::text[])`,
    [...columns, DERIVED_EDGE_LABELS],
  );
};

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
  counted AS (
    SELECT gen, count(*)::int AS nodes, 0 AS edges FROM swept_nodes GROUP BY gen
    UNION ALL
    SELECT gen, 0 AS nodes, count(*)::int AS edges FROM swept_edges GROUP BY gen
  )
  SELECT gen, sum(nodes)::int AS nodes, sum(edges)::int AS edges
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
