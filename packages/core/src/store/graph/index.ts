import {
  CONCEPT_NODE_LABEL,
  citedSourceOf,
  type conceptFrontmatter,
  IRI,
  LINKS_TO_LABEL,
  resolvedResource,
  SUPERSEDES_LABEL,
} from "@better-answers/schema";
import type pg from "pg";
import type { z } from "zod";

import { readableClause, readableParameter } from "../../access/index.ts";
import type { UserPrincipal } from "../../kernel/index.ts";

/**
 * The graph door: the one graph query module in this tier (ADR 0032) — the delta builder
 * the governed write's transaction runs, and the prepared recursive-CTE traversal
 * templates. The graph is plain Postgres tables under RLS; there is no AGE, no Cypher and
 * no second engine (ADR 0032 superseding ADR 0023's engine), so the templates interpolate
 * `access`'s one SQL predicate — on **every element of every path**, not on the endpoints
 * alone, because a traversal that filters only where it starts and ends leaks the middle,
 * and a path with one withheld element is no path.
 *
 * The workspace id is a term of every statement beside the predicate (ADR 0023's *graph is
 * application data* amendment): RLS scopes the transaction already, and naming the pair
 * says so where a reader of the SQL can see it.
 *
 * ADR 0029's tree names this door as the module that emits the access predicate; that is
 * why it is the one store module that imports `access` — a template rendered anywhere else
 * would be a second place the predicate could be forgotten.
 */

/**
 * One transaction's client, structurally the Postgres door's `Tx`: restated rather than
 * imported because no store file imports another store file (ADR 0029), and the shape is
 * the seam — a caller inside the governed write's transaction hands its own client in.
 */
type Tx = Pick<pg.PoolClient, "query">;

/** A concept's frontmatter, in the one shape the boundary holds a row to (ADR 0028). */
type Frontmatter = z.infer<typeof conceptFrontmatter>;

/**
 * What the delta derives from one committed concept — the index row's own facts, handed in
 * by the slice that just wrote them. `isNew` is whether this IRI had no row before the act:
 * a newly landed concept is the one moment a *path* link written earlier can start
 * resolving, so it is when the linkers are re-derived (below).
 */
export type ConceptDelta = {
  readonly iri: string;
  /** The folded kind the index row carries — the node's property, never its label. */
  readonly kind: string;
  readonly path: string;
  readonly body: string;
  readonly frontmatter: Frontmatter;
  readonly publishedAt: Date | null;
  readonly sensitivity: string;
  readonly audience: string;
  readonly isNew: boolean;
};

/** What one row of the map answers a walk with: the element, and the path that reached it. */
export type WalkStep = {
  readonly uid: string;
  readonly label: string;
  readonly kind: string | null;
  readonly depth: number;
  readonly path: readonly string[];
};

/**
 * The walk's depth, capped **by the template and never by the caller** (ADR 0032): the
 * recursive term stops expanding at this many hops, so no argument can widen it.
 */
export const GRAPH_WALK_DEPTH = 4;

/**
 * The derivation rule for a concept's outgoing edges, stated once because the worker's
 * full rebuild must reproduce it exactly (T-057's rebuild-equivalence):
 *
 * - Every **inline markdown link** in the body (`[text](target)`, reference-style links
 *   and autolinks deliberately not read) whose target is a concept — a concept IRI, or a
 *   bundle path resolved against the file (ADR 0019's resolution) that the index holds —
 *   is a `LINKS_TO` edge carrying the two kinds, the nearest preceding heading as its
 *   *section* and the sentence around the link, with markdown link syntax flattened to its
 *   text (ADR 0026).
 * - Every `sources[]` entry naming a concept the same two ways is a `SUPERSEDES` edge —
 *   the successor carries the lineage (ADR 0019; `docs/okf-v02.md`), one edge per
 *   superseded concept.
 * - An **IRI** target makes its edge whether or not the target has landed — a link to
 *   not-yet-written knowledge is legal, the edge dangles, and the walk's node join keeps a
 *   dangling edge off every path. A **path** target makes its edge only once the index
 *   resolves it, which is what the new-concept re-derive exists for.
 * - An edge's uid is `<label>:<from IRI>:<ordinal>`, the ordinal being the reference's
 *   position among the body's links (or the `sources[]` entries), resolvable or not — so a
 *   link that starts resolving later changes no neighbour's uid.
 */
const INLINE_LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)[^)]*\)/g;

/** The link and lineage columns of one derived edge; named edges carry the four as NULL. */
type OutgoingEdge = {
  readonly uid: string;
  readonly label: string;
  readonly toUid: string;
  readonly toKind: string | null;
  readonly section: string | null;
  readonly sentence: string | null;
};

/** A reference before resolution: where it points, and what the edge will carry. */
type OutgoingRef = {
  readonly label: string;
  readonly ordinal: number;
  readonly target: Readonly<{ iri: string } | { path: string }>;
  readonly section: string | null;
  readonly sentence: string | null;
};

/** A target as written, read as the concept it names: its IRI, its resolved path, or nothing. */
const targetOf = (raw: string, from: string): OutgoingRef["target"] | undefined => {
  const bare = raw.split("#")[0] ?? "";
  if (bare === "") return undefined;
  if (IRI.test(bare)) return { iri: bare };
  // Any other scheme'd target is an external resource, never a concept.
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) return undefined;
  return { path: resolvedResource(bare, from).slice(1) };
};

/** The nearest preceding ATX heading's text — the *section* a link sits under. */
const sectionAt = (body: string, index: number): string | null => {
  const lines = body.slice(0, index).split("\n");
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const heading = /^#{1,6}\s+(.*)$/.exec(lines[at] ?? "");
    if (heading !== null) return (heading[1] ?? "").trim();
  }
  return null;
};

/** Markdown link syntax flattened to its text, as the sentence's reader would say it. */
const flattenedLinks = (text: string): string => text.replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1");

/**
 * The sentence around one position: the enclosing paragraph cut at the sentence
 * terminators either side, links flattened, whitespace collapsed. A deterministic reading,
 * because the rebuild must derive the same sentence from the same bytes.
 */
const sentenceAt = (body: string, index: number): string => {
  const before = body.lastIndexOf("\n\n", index);
  const paragraphStart = before === -1 ? 0 : before + 2;
  const after = body.indexOf("\n\n", index);
  const paragraph = body.slice(paragraphStart, after === -1 ? body.length : after);
  const at = index - paragraphStart;

  let start = 0;
  let end = paragraph.length;
  for (const boundary of paragraph.matchAll(/[.!?](?=\s|$)/g)) {
    if (boundary.index < at) start = boundary.index + 1;
    else {
      end = boundary.index + 1;
      break;
    }
  }
  return flattenedLinks(paragraph.slice(start, end)).replaceAll(/\s+/g, " ").trim();
};

/** Every outgoing reference one concept's file makes, in the derivation rule's order. */
const referencesOf = (concept: {
  readonly iri: string;
  readonly path: string;
  readonly body: string;
  readonly frontmatter: Frontmatter;
}): readonly OutgoingRef[] => {
  const links = [...concept.body.matchAll(INLINE_LINK)].flatMap((match, ordinal) => {
    const target = targetOf(match[1] ?? "", concept.path);
    if (target === undefined) return [];
    return [
      {
        label: LINKS_TO_LABEL,
        ordinal,
        target,
        section: sectionAt(concept.body, match.index),
        sentence: sentenceAt(concept.body, match.index),
      },
    ];
  });

  const sources = concept.frontmatter["sources"];
  const lineage = (Array.isArray(sources) ? sources : []).flatMap((entry, ordinal) => {
    const cited = citedSourceOf(entry);
    const target = cited === undefined ? undefined : targetOf(cited.resource, concept.path);
    if (target === undefined) return [];
    return [{ label: SUPERSEDES_LABEL, ordinal, target, section: null, sentence: null }];
  });

  return [...links, ...lineage];
};

/** A concept the resolution found on the index: its identity and its kind. */
type ResolvedConcept = { readonly iri: string; readonly kind: string };

type ResolvedRow = { readonly iri: string; readonly kind: string; readonly path: string };

/**
 * The references resolved against the index — paths to the concepts that hold them, IRIs
 * to their kinds — and reduced to the edges the file makes today. Lineage to one concept
 * is one edge however many `sources[]` entries repeat it.
 */
const resolveOutgoing = async (
  workspaceId: string,
  tx: Tx,
  concept: Parameters<typeof referencesOf>[0],
): Promise<readonly OutgoingEdge[]> => {
  const references = referencesOf(concept);
  const paths = [
    ...new Set(references.flatMap((ref) => ("path" in ref.target ? [ref.target.path] : []))),
  ];
  const iris = [
    ...new Set(references.flatMap((ref) => ("iri" in ref.target ? [ref.target.iri] : []))),
  ];

  const byPath = new Map<string, ResolvedConcept>();
  if (paths.length > 0) {
    const found = await tx.query<ResolvedRow>(
      "SELECT iri, kind, path FROM concept_index WHERE workspace_id = $1 AND path = ANY($2::text[])",
      [workspaceId, paths],
    );
    for (const row of found.rows) byPath.set(row.path, { iri: row.iri, kind: row.kind });
  }
  const kindByIri = new Map<string, string>();
  if (iris.length > 0) {
    const found = await tx.query<ResolvedRow>(
      "SELECT iri, kind, path FROM concept_index WHERE workspace_id = $1 AND iri = ANY($2::text[])",
      [workspaceId, iris],
    );
    for (const row of found.rows) kindByIri.set(row.iri, row.kind);
  }

  const superseded = new Set<string>();
  return references.flatMap((ref) => {
    const resolved =
      "iri" in ref.target
        ? { iri: ref.target.iri, kind: kindByIri.get(ref.target.iri) ?? null }
        : byPath.get(ref.target.path);
    if (resolved === undefined) return [];
    if (ref.label === SUPERSEDES_LABEL) {
      if (superseded.has(resolved.iri)) return [];
      superseded.add(resolved.iri);
    }
    const linksTo = ref.label === LINKS_TO_LABEL;
    return [
      {
        uid: `${ref.label.toLowerCase()}:${concept.iri}:${ref.ordinal}`,
        label: ref.label,
        toUid: resolved.iri,
        toKind: linksTo ? (resolved.kind ?? null) : null,
        section: linksTo ? ref.section : null,
        sentence: linksTo ? ref.sentence : null,
      },
    ];
  });
};

/** The facts an edge copies from the file it derives from, visibility included. */
type EdgeSource = {
  readonly iri: string;
  readonly kind: string;
  readonly path: string;
  readonly body: string;
  readonly frontmatter: Frontmatter;
  readonly publishedAt: Date | null;
  readonly sensitivity: string;
  readonly audience: string;
};

/**
 * One concept's outgoing edges replaced in the live generation: deleted and re-derived
 * from the file as it stands, so a removed link leaves the map in the same act. An edge
 * wears the **from**-concept's visibility columns — its section and sentence are that
 * file's content, which is what the predicate on the edge must be able to withhold —
 * until T-055's derivation refines the rule.
 */
const replaceOutgoingEdges = async (
  workspaceId: string,
  gen: number,
  tx: Tx,
  concept: EdgeSource,
): Promise<void> => {
  const edges = await resolveOutgoing(workspaceId, tx, concept);
  await tx.query(
    `DELETE FROM graph_edge
      WHERE workspace_id = $1 AND gen = $2 AND from_uid = $3 AND label = ANY($4::text[])`,
    [workspaceId, gen, concept.iri, [LINKS_TO_LABEL, SUPERSEDES_LABEL]],
  );
  for (const edge of edges) {
    await tx.query(
      `INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid, from_kind,
                               to_kind, section, sentence, published_at, sensitivity, audience)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
      ],
    );
  }
};

/** A `LIKE` needle with its wildcards escaped, so a filename is matched as itself. */
const escapedLike = (needle: string): string =>
  `%${needle.replaceAll(/[\\%_]/g, String.raw`\$&`)}%`;

type LinkerRow = {
  readonly iri: string;
  readonly kind: string;
  readonly path: string;
  readonly body: string;
  /** The row's jsonb, which the boundary parsed on the way in (ADR 0028). */
  readonly frontmatter: Frontmatter;
  readonly published_at: Date | null;
  readonly sensitivity: string;
  readonly audience: string;
};

/**
 * The workspace's live generation, created at 1 by the first delta that needs it. The
 * no-op `DO UPDATE` is what makes one statement both the create and the read; a full
 * rebuild's flip is an ordinary `UPDATE` of this row and never this door's business.
 */
const liveGeneration = async (workspaceId: string, tx: Tx): Promise<number> => {
  const row = await tx.query<{ live_gen: number }>(
    `INSERT INTO graph_generation (workspace_id, live_gen) VALUES ($1, 1)
     ON CONFLICT (workspace_id) DO UPDATE SET live_gen = graph_generation.live_gen
     RETURNING live_gen`,
    [workspaceId],
  );
  const liveGen = row.rows[0]?.live_gen;
  if (liveGen === undefined) throw new Error("the live generation could not be read");
  return liveGen;
};

/**
 * The bundle-and-record delta of one governed write, emitted as plain SQL **inside the
 * act's own transaction** (ADR 0023: the delta joins the app's commit transaction), so an
 * edit's map change lands or rolls back with its rows and the map is never behind for an
 * edit. Generations are for full rebuilds only: this writes into the live one and mints
 * nothing.
 *
 * Five steps: the live generation read (created at 1 on a workspace's first delta); the
 * concept's node upserted with the index row's kind and visibility; the inbound
 * `LINKS_TO` edges' `to_kind` refreshed, because a re-write may have moved the kind they
 * denormalise; the concept's outgoing edges replaced from the file; and — on a **new**
 * concept only — every concept whose file names this one's path re-derived, which is the
 * moment a link to formerly not-yet-written knowledge starts resolving. An IRI link needs
 * no re-derive: its edge was made dangling when its file landed, and the node this step
 * upserts is what completes the path.
 */
export const writeConceptDelta = async (
  principal: UserPrincipal,
  tx: Tx,
  delta: ConceptDelta,
): Promise<void> => {
  const workspaceId = principal.workspaceId;
  const gen = await liveGeneration(workspaceId, tx);

  await tx.query(
    `INSERT INTO graph_node (workspace_id, gen, uid, label, kind, published_at, sensitivity, audience)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (workspace_id, gen, uid) WHERE gen IS NOT NULL
     DO UPDATE SET kind = EXCLUDED.kind, published_at = EXCLUDED.published_at,
                   sensitivity = EXCLUDED.sensitivity, audience = EXCLUDED.audience`,
    [
      workspaceId,
      gen,
      delta.iri,
      CONCEPT_NODE_LABEL,
      delta.kind,
      delta.publishedAt,
      delta.sensitivity,
      delta.audience,
    ],
  );
  await tx.query(
    `UPDATE graph_edge SET to_kind = $4
      WHERE workspace_id = $1 AND gen = $2 AND label = '${LINKS_TO_LABEL}' AND to_uid = $3
        AND to_kind IS DISTINCT FROM $4`,
    [workspaceId, gen, delta.iri, delta.kind],
  );
  await replaceOutgoingEdges(workspaceId, gen, tx, delta);

  if (!delta.isNew) return;
  const linkers = await tx.query<LinkerRow>(
    `SELECT iri, kind, path, body, frontmatter, published_at, sensitivity, audience
       FROM concept_index
      WHERE workspace_id = $1 AND iri <> $2
        AND (body LIKE $3 OR frontmatter::text LIKE $3)`,
    [workspaceId, delta.iri, escapedLike(delta.path.split("/").at(-1) ?? delta.path)],
  );
  for (const row of linkers.rows) {
    await replaceOutgoingEdges(workspaceId, gen, tx, {
      iri: row.iri,
      kind: row.kind,
      path: row.path,
      body: row.body,
      frontmatter: row.frontmatter,
      publishedAt: row.published_at,
      sensitivity: row.sensitivity,
      audience: row.audience,
    });
  }
};

/**
 * The traversal templates: prepared recursive CTEs rendered **once, at module load**, with
 * the read predicate interpolated on the entry node, on every edge and on every node a
 * step reaches — so a withheld element prunes the walk there, and everything beyond it is
 * unreachable *through it*. The entry is by key (a uid — a concept's IRI), never a
 * graph-side index (ADR 0023); depth is the template's literal; a bundle-and-record row
 * binds the live generation and a source entity, which carries none, walks beside it.
 *
 * $1 is the workspace, $2 the entry uid, $3 the predicate's parameter
 * (`readableParameter`). The cycle guard is the path itself: a step never revisits a uid
 * its path already holds.
 */
const walkStatement = (outward: boolean): string => {
  const [source, sink] = outward ? ["from_uid", "to_uid"] : ["to_uid", "from_uid"];
  return `WITH RECURSIVE live AS (
    SELECT live_gen FROM graph_generation WHERE workspace_id = $1
  ),
  walk AS (
    SELECT n.uid, n.label, n.kind, 0 AS depth, ARRAY[n.uid] AS path
      FROM graph_node n
      JOIN live ON n.gen IS NULL OR n.gen = live.live_gen
     WHERE n.workspace_id = $1 AND n.uid = $2
       AND ${readableClause("n", 3)}
    UNION ALL
    SELECT m.uid, m.label, m.kind, w.depth + 1, w.path || m.uid
      FROM walk w
      JOIN graph_edge e ON e.workspace_id = $1 AND e.${source} = w.uid
      JOIN live edge_live ON e.gen IS NULL OR e.gen = edge_live.live_gen
      JOIN graph_node m ON m.workspace_id = $1 AND m.uid = e.${sink}
      JOIN live node_live ON m.gen IS NULL OR m.gen = node_live.live_gen
     WHERE w.depth < ${GRAPH_WALK_DEPTH}
       AND m.uid <> ALL(w.path)
       AND ${readableClause("e", 3)}
       AND ${readableClause("m", 3)}
  )
  SELECT uid, label, kind, depth, path FROM walk ORDER BY depth, uid`;
};

const WALK_FROM = walkStatement(true);
const WALK_TO = walkStatement(false);

type WalkRow = {
  readonly uid: string;
  readonly label: string;
  readonly kind: string | null;
  readonly depth: number;
  readonly path: readonly string[];
};

const walk = async (
  statement: string,
  principal: UserPrincipal,
  tx: Tx,
  uid: string,
): Promise<readonly WalkStep[]> => {
  const found = await tx.query<WalkRow>(statement, [
    principal.workspaceId,
    uid,
    readableParameter(principal),
  ]);
  return found.rows.map((row) => ({
    uid: row.uid,
    label: row.label,
    kind: row.kind,
    depth: row.depth,
    path: row.path,
  }));
};

/**
 * Everything reachable **outward** from one element, the entry itself at depth 0 — or
 * nothing at all when the entry is withheld from this caller or was never mapped, which
 * answer alike on purpose.
 */
export const walkFrom = (
  principal: UserPrincipal,
  tx: Tx,
  uid: string,
): Promise<readonly WalkStep[]> => walk(WALK_FROM, principal, tx, uid);

/** The same walk against the edges' direction: what reaches this element. */
export const walkTo = (
  principal: UserPrincipal,
  tx: Tx,
  uid: string,
): Promise<readonly WalkStep[]> => walk(WALK_TO, principal, tx, uid);
