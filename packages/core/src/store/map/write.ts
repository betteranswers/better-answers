import type pg from "pg";
import type { z } from "zod";

import {
  CONCEPT_DEPRECATED_STATUS,
  CONCEPT_NODE_LABEL,
  citedSourcesOf,
  type CitedSource,
  type conceptFrontmatter,
  DERIVED_FROM_LABEL,
  IRI,
  LINKS_TO_LABEL,
  resolvedResource,
  SUPERSEDES_LABEL,
  type UNRESOLVED_RELATIONS,
} from "@better-answers/schema";
import { linksAndMarksOf, proseOf, uriDecoded } from "@better-answers/schema/concept-file";
import { SCHEMED } from "@better-answers/schema/scan";

import type { Principal } from "../../kernel/index.ts";
import { sectionAt, sentenceAt } from "./sentence.ts";

export type Tx = Pick<pg.PoolClient, "query">;

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

type OutgoingEdge = {
  readonly uid: string;
  readonly label: string;
  readonly toUid: string;
  readonly toKind: string | null;
  readonly section: string | null;
  readonly sentence: string | null;
};

type Relation = (typeof UNRESOLVED_RELATIONS)[number];

type OutgoingRef = {
  readonly relation: Relation;
  readonly ordinal: number;
  readonly target: Readonly<{ iri: string } | { path: string }>;
  readonly section: string | null;
  readonly sentence: string | null;
};

export const targetOf = (raw: string, from: string): OutgoingRef["target"] | undefined => {
  const bare = raw.split("#")[0] ?? "";
  if (bare === "") return undefined;
  if (IRI.test(bare)) return { iri: bare };

  if (SCHEMED.test(bare) || bare.startsWith("//")) return undefined;
  const decoded = uriDecoded(bare);
  if (decoded.includes("\u0000")) return undefined;
  const path = resolvedResource(decoded, from).slice(1);
  return path === "" ? undefined : { path };
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

        sentence: sentenceAt(concept.body, prose, link.at),
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

type UnresolvedReference = {
  readonly relation: Relation;
  readonly ordinal: number;
  readonly targetPath: string;
};

type Outgoing = {
  readonly edges: readonly OutgoingEdge[];
  readonly unresolved: readonly UnresolvedReference[];
};

const resolveOutgoing = async (tx: Tx, concept: EdgeSource): Promise<Outgoing> => {
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

  const unresolved = references.flatMap((ref): readonly UnresolvedReference[] =>
    "path" in ref.target && !byPath.has(ref.target.path)
      ? [{ relation: ref.relation, ordinal: ref.ordinal, targetPath: ref.target.path }]
      : [],
  );
  const cited = new Set<string>();
  const edges = references.flatMap((ref): readonly OutgoingEdge[] => {
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
  return { edges, unresolved };
};

const DERIVED_EDGE_LABELS = [LINKS_TO_LABEL, SUPERSEDES_LABEL, DERIVED_FROM_LABEL];

const replaceOutgoingEdges = async (gen: number, tx: Tx, concept: EdgeSource): Promise<void> => {
  const workspaceId = concept.workspaceId;
  const { edges, unresolved } = await resolveOutgoing(tx, concept);
  await tx.query(
    `DELETE FROM map_edge
      WHERE workspace_id = $1 AND gen = $2 AND from_uid = $3 AND label = ANY($4::text[])`,
    [workspaceId, gen, concept.iri, DERIVED_EDGE_LABELS],
  );
  await tx.query(
    "DELETE FROM map_unresolved_reference WHERE workspace_id = $1 AND gen = $2 AND from_uid = $3",
    [workspaceId, gen, concept.iri],
  );
  if (unresolved.length > 0) {
    await tx.query(
      `INSERT INTO map_unresolved_reference (workspace_id, gen, from_uid, relation, ordinal,
                                             target_path)
       SELECT $1, $2, $3, relation, ordinal, target_path
         FROM unnest($4::text[], $5::int[], $6::text[]) AS r(relation, ordinal, target_path)`,
      [
        workspaceId,
        gen,
        concept.iri,
        unresolved.map((ref) => ref.relation),
        unresolved.map((ref) => ref.ordinal),
        unresolved.map((ref) => ref.targetPath),
      ],
    );
  }
  for (const edge of edges) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- every edge insert runs on the caller's transaction
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

export const existingLiveGen = async (workspaceId: string, tx: Tx): Promise<number | null> => {
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

  const citing = await tx.query<ConceptIndexRow>(
    `SELECT workspace_id AS "workspaceId", iri, kind, path, body, frontmatter,
            published_at AS "publishedAt", sensitivity, audience,
            audience_groups AS "audienceGroups"
       FROM concept_index
      WHERE workspace_id = $1 AND iri IN (
            SELECT from_uid FROM map_unresolved_reference
             WHERE workspace_id = $1 AND gen = $2 AND target_path = $3)`,
    [workspaceId, gen, delta.path],
  );

  for (const { frontmatter, ...row } of citing.rows) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- every edge replacement runs on the caller's transaction
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
