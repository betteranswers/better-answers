import {
  CONCEPT_DEPRECATED_STATUS,
  CONCEPT_NODE_LABEL,
  citedSourceOf,
  type conceptFrontmatter,
  DERIVED_FROM_LABEL,
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
 * templates. The graph is plain Postgres tables under RLS, so the templates interpolate
 * `access`'s one SQL predicate — on **every element of every path**, not on the endpoints
 * alone, because a traversal that filters only where it starts and ends leaks the middle,
 * and a path with one withheld element is no path.
 *
 * The workspace id is a term of every statement beside the predicate (ADR 0023's *graph is
 * application data* amendment): RLS scopes the transaction already, and naming the pair
 * says so where a reader of the SQL can see it.
 *
 * `access` is imported here and in no other store module (ADR 0029): a traversal template
 * must be unable to exist without the predicate, and a renderer handed in by a caller
 * would be a place to forget it.
 *
 * **A walk answers with node fields only** (`WalkStep`); no edge column is projected.
 * `to_uid` and `to_kind` name a concept the from-side's visibility says nothing about — a
 * guessed path in a file can mint an edge at a Restricted concept — so before any surface
 * projects an edge's columns, the target's own predicate must be applied to that edge's
 * read. T-055's derivation and B9's reads inherit this rule; a test pins it meanwhile.
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
 * What edges derive from: one concept's index-row facts — its identity, its folded kind
 * (the node's property, never its label), the file's content and the three visibility
 * columns an edge copies. The shape the re-derive reads back off `concept_index` too,
 * which is why the row and the delta share it.
 */
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
 * What the delta is handed by the slice that just wrote the row: the edge facts, and the
 * concept's `status` — what the inbound lineage relabel reads, because a deprecation flips
 * its successors' edges (ADR 0019). Whether the concept is newly on the map is this door's
 * own read, off `graph_node` (`writeConceptDelta`), never a fact handed in.
 */
export type ConceptDelta = EdgeSource & {
  readonly status: string;
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
 * The walk's row cap, in the template like the depth: a dense map multiplies *paths* even
 * at four hops, and an unbounded statement would let one file's worth of edges cost the
 * whole box. Generous against any legitimate expansion — an answer drafts over a handful
 * of concepts, not a thousand paths — and the closest rows win the cut, because the
 * recursion yields shallow depths first. T-058's budget test measures the real cost.
 */
export const GRAPH_WALK_ROW_LIMIT = 1_000;

/**
 * The derivation rule for a concept's outgoing edges, stated once because the worker's
 * full rebuild must reproduce it exactly (T-057's rebuild-equivalence):
 *
 * - Every **markdown link** in the body — inline `[text](target)`; a reference in its
 *   full, collapsed or shortcut form, resolved through the body's own `[label]: target`
 *   definitions (first definition wins, labels case-folded and space-collapsed); an
 *   autolink `<target>` — whose target is a concept (a concept IRI, or a bundle path
 *   resolved against the file — ADR 0019's resolution — that the index holds) is a
 *   `LINKS_TO` edge carrying the two kinds, the nearest preceding heading as its
 *   *section* and the sentence around the link, link syntax flattened to its text
 *   (ADR 0023's "every markdown link between concepts"; ADR 0026).
 * - An **image** (`![…]`, in any reference form) derives no edge — a transclusion shows a
 *   resource, it does not assert between concepts — but is matched and holds its ordinal,
 *   exactly as an unresolvable target does, so removing the `!` later renumbers no
 *   neighbour. A reference, a `[label]: target` definition or a heading inside an
 *   **inline code span or fenced code block** is quotation, not assertion: spans and
 *   fences are blanked to spaces (offsets kept) before every scan — a fence closes at the
 *   first fence line of its own character at least its opener's length, a span pairs a
 *   backtick run with the next run of exactly its length, an unpaired run is literal
 *   text (CommonMark's rules) — so code derives no edge, defines no label, names no
 *   section, holds no ordinal and enters no sentence. A **protocol-relative** target
 *   (`//host/…`) is an external resource like any scheme'd URL, never a concept.
 * - Every `sources[]` entry naming a concept the same two ways is a **lineage** edge —
 *   the successor carries the lineage (`docs/okf-v02.md`) — labelled by ADR 0019's rule:
 *   `SUPERSEDES` when it resolves to a `status: deprecated` concept of the same kind,
 *   `DERIVED_FROM` otherwise; one edge per cited concept, and the inbound lineage labels
 *   are revisited on every commit of the cited concept, so a deprecation flips its
 *   successors' edges with no edit to them.
 * - An **IRI** target makes its edge whether or not the target has landed — a link to
 *   not-yet-written knowledge is legal, the edge dangles (`DERIVED_FROM`, for lineage,
 *   until the landing's revisit says otherwise), and the walk's node join keeps a
 *   dangling edge off every path. A **path** target makes its edge only once the index
 *   resolves it, which is what the new-concept re-derive exists for.
 * - An edge's uid is `links_to:<from IRI>:<ordinal>`, or `lineage:<from IRI>:<ordinal>`
 *   with **one prefix for both lineage labels** so a relabel moves no key; the ordinal is
 *   the reference's position among the body's link references of any form (or among the
 *   `sources[]` entries), in document order, whether or not it resolves — so a link that
 *   starts resolving later changes no neighbour's uid.
 */
const LINK_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(\S+)/gm;

/**
 * Every link-reference form, one alternation so document order is one scan: inline, then
 * full/collapsed reference, then shortcut, then autolink — the order is what lets the
 * longer form win where two could start at one bracket.
 */
const LINK = /\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\[[^\]]*\]|\[[^\]]*\]|<[a-z][a-z0-9+.-]*:[^>\s]*>/gi;

/**
 * A fenced code block: the fence line, everything to the first closing fence of its own
 * character **at least the opener's length** (CommonMark allows a longer closer), or the
 * file's end.
 */
const FENCED_BLOCK = /^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*$|(?![\s\S]))/gm;

/** Everything but the newlines blanked, so an index into the prose is an index into the file. */
const blanked = (text: string): string => text.replaceAll(/[^\n]/g, " ");

/**
 * Inline code spans blanked by one left-to-right pass over the backtick runs: a run
 * closes with the next run of exactly its length, an unpaired run is literal text
 * (CommonMark). A scanner rather than a backtracking regex, because the body is tenant
 * input and a long unmatched run would cost a regex quadratic time inside the governed
 * write's transaction.
 */
const blankedSpans = (body: string): string => {
  const runs = [...body.matchAll(/`+/g)];
  // Every run's place in the list, queued per length in document order as the closers a
  // later run of that length may take: an opener reads the head of its own length's queue,
  // discarding entries at or before itself — a run a blanked span already consumed
  // included — so no run is scanned twice and the pairing stays linear whatever mix of
  // unpaired lengths the input carries. The first run of a length opens its queue and is
  // not in it: nothing before it could it close, and the opener at its own position would
  // discard the entry unread.
  const queued = new Map<number, number[]>();
  for (const [position, run] of runs.entries()) {
    const queue = queued.get(run[0].length);
    if (queue === undefined) queued.set(run[0].length, []);
    else queue.push(position);
  }
  const heads = new Map<number, number>();

  const pieces: string[] = [];
  let cursor = 0;
  for (let at = 0; at < runs.length; at += 1) {
    const opener = runs[at];
    if (opener === undefined) continue;
    const queue = queued.get(opener[0].length) ?? [];
    let head = heads.get(opener[0].length) ?? 0;
    while (head < queue.length) {
      const position = queue[head];
      if (position === undefined || position > at) break;
      head += 1;
    }
    heads.set(opener[0].length, head);
    const closer = runs[queue[head] ?? -1];
    if (closer === undefined) continue;
    const end = closer.index + closer[0].length;
    pieces.push(body.slice(cursor, opener.index), blanked(body.slice(opener.index, end)));
    cursor = end;
    at = queue[head] ?? at;
  }
  pieces.push(body.slice(cursor));
  return pieces.join("");
};

/** The body's prose: code blanked before any scan — fences first, so a span cannot eat a fence. */
const proseOf = (body: string): string => blankedSpans(body.replace(FENCED_BLOCK, blanked));

/** A reference label as definitions key it: trimmed, spaces collapsed, case folded. */
const normalisedLabel = (label: string): string =>
  label.trim().replaceAll(/\s+/g, " ").toLowerCase();

/** The body's `[label]: target` definitions; the first definition of a label wins. */
const definitionsOf = (body: string): ReadonlyMap<string, string> => {
  const definitions = new Map<string, string>();
  for (const match of body.matchAll(LINK_DEFINITION)) {
    const label = normalisedLabel(match[1] ?? "");
    if (!definitions.has(label)) {
      definitions.set(label, (match[2] ?? "").replace(/^</, "").replace(/>$/, ""));
    }
  }
  return definitions;
};

/** One matched reference's target as written, or nothing — an undefined label, say. */
const linkTargetOf = (
  match: RegExpExecArray,
  body: string,
  definitions: ReadonlyMap<string, string>,
): string | undefined => {
  const text = match[0];
  if (text.startsWith("<")) return text.slice(1, -1);
  if (text.includes("](")) return /\]\(\s*<?([^)\s>]+)/.exec(text)?.[1];
  const reference = /^\[([^\]]*)\]\[([^\]]*)\]$/.exec(text);
  if (reference !== null) {
    // The collapsed form `[label][]` names itself; the full form names its second pair.
    return definitions.get(
      normalisedLabel((reference[2] === "" ? reference[1] : reference[2]) ?? ""),
    );
  }
  // A shortcut reference — unless the bracket is a definition's own label, which the
  // colon after it says, and unless nothing defines it, in which case it is plain text.
  if (body[match.index + text.length] === ":") return undefined;
  return definitions.get(normalisedLabel(text.slice(1, -1)));
};

/** The link and lineage columns of one derived edge; named edges carry the four as NULL. */
type OutgoingEdge = {
  readonly uid: string;
  readonly label: string;
  readonly toUid: string;
  readonly toKind: string | null;
  readonly section: string | null;
  readonly sentence: string | null;
};

/**
 * A reference before resolution: where it points, and what the edge will carry. A `link`
 * becomes `LINKS_TO`; a `lineage` reference's label is the resolution's to decide, by ADR
 * 0019's rule.
 */
type OutgoingRef = {
  readonly relation: "link" | "lineage";
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
  // Any other scheme'd target — and the protocol-relative `//host/…` form — is an
  // external resource, never a concept.
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("//")) return undefined;
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
const flattenedLinks = (text: string): string =>
  text
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replaceAll(/\[([^\]]*)\]/g, "$1")
    .replaceAll(/<([a-z][a-z0-9+.-]*:[^>\s]*)>/gi, "$1");

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
const referencesOf = (concept: EdgeSource): readonly OutgoingRef[] => {
  const prose = proseOf(concept.body);
  const definitions = definitionsOf(prose);
  const links = [...prose.matchAll(LINK)].flatMap((match, ordinal) => {
    // An image: matched, holding its ordinal, deriving nothing.
    if (prose[match.index - 1] === "!") return [];
    const raw = linkTargetOf(match, prose, definitions);
    const target = raw === undefined ? undefined : targetOf(raw, concept.path);
    if (target === undefined) return [];
    return [
      {
        relation: "link" as const,
        ordinal,
        target,
        section: sectionAt(prose, match.index),
        // The prose, as the section reads it: a quoted code link never enters a sentence.
        sentence: sentenceAt(prose, match.index),
      },
    ];
  });

  const sources = concept.frontmatter["sources"];
  const lineage = (Array.isArray(sources) ? sources : []).flatMap((entry, ordinal) => {
    const cited = citedSourceOf(entry);
    const target = cited === undefined ? undefined : targetOf(cited.resource, concept.path);
    if (target === undefined) return [];
    return [{ relation: "lineage" as const, ordinal, target, section: null, sentence: null }];
  });

  return [...links, ...lineage];
};

/** A cited concept as the label rule reads it; kind and status NULL while it is unlanded. */
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

/**
 * Whether a resolved lineage target makes the reference a succession: `status: deprecated`
 * and the same kind as the citing concept — ADR 0019's rule, and the whole of it.
 */
const supersedes = (target: ResolvedTarget, fromKind: string): boolean =>
  target.status === CONCEPT_DEPRECATED_STATUS && target.kind === fromKind;

/**
 * The references resolved against the index — paths to the concepts that hold them, IRIs
 * to their kinds and statuses — and reduced to the edges the file makes today. Lineage to
 * one concept is one edge however many `sources[]` entries repeat it.
 */
const resolveOutgoing = async (
  principal: UserPrincipal,
  tx: Tx,
  concept: EdgeSource,
): Promise<readonly OutgoingEdge[]> => {
  const workspaceId = principal.workspaceId;
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

/**
 * One concept's outgoing edges replaced in the live generation: deleted and re-derived
 * from the file as it stands, so a removed link leaves the map in the same act. An edge
 * wears the **from**-concept's visibility columns — its section and sentence are that
 * file's content, which is what the predicate on the edge must be able to withhold —
 * until T-055's derivation refines the rule.
 */
const replaceOutgoingEdges = async (
  principal: UserPrincipal,
  gen: number,
  tx: Tx,
  concept: EdgeSource,
): Promise<void> => {
  const workspaceId = principal.workspaceId;
  const edges = await resolveOutgoing(principal, tx, concept);
  await tx.query(
    `DELETE FROM graph_edge
      WHERE workspace_id = $1 AND gen = $2 AND from_uid = $3 AND label = ANY($4::text[])`,
    [workspaceId, gen, concept.iri, [LINKS_TO_LABEL, SUPERSEDES_LABEL, DERIVED_FROM_LABEL]],
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

/**
 * The filename in link-target position, as a Postgres regex: preceded by the start, a
 * space, a quote, `(`, `<`, `:`, `/` or `[` — everywhere a markdown link, a reference
 * definition or a `sources[]` entry can put it, and nowhere a word can merely contain it.
 * A candidate **pre-filter**, not the derivation rule: the re-derive it feeds resolves
 * targets properly and is idempotent, so precision here is cost, never edges — which is
 * also why the rebuild has no scan to reproduce.
 */
const namePattern = (filename: string): string =>
  `(^|[\\s"'(<:/[])${filename.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`;

/**
 * The workspace's live generation, created at 1 by the first delta that needs it. The
 * no-op `DO UPDATE` is what makes one statement both the create and the read; a full
 * rebuild's flip is an ordinary `UPDATE` of this row and never this door's business.
 */
const liveGeneration = async (principal: UserPrincipal, tx: Tx): Promise<number> => {
  const row = await tx.query<{ live_gen: number }>(
    `INSERT INTO graph_generation (workspace_id, live_gen) VALUES ($1, 1)
     ON CONFLICT (workspace_id) DO UPDATE SET live_gen = graph_generation.live_gen
     RETURNING live_gen`,
    [principal.workspaceId],
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
 * The inbound refreshes run on every commit, not only a deprecation's: a `LINKS_TO` edge
 * denormalises this concept's kind, and a lineage label reads this concept's status and
 * its successors' kinds (ADR 0019's "inbound links revisited"), any of which this act may
 * have moved. The linker re-derive runs only when the live generation held **no node for
 * this IRI** before the act — the moment a link to formerly not-yet-written knowledge
 * starts resolving. Newness is read off the map itself, never handed in: an index row
 * older than the graph tables, or a restore that carried the records without the derived
 * store, backfills its inbound path links on its first edit this way. An IRI link needs
 * no re-derive: its edge was made dangling when its file landed, the node upsert
 * completes the path, and the two refreshes put the right kind and label on it.
 */
export const writeConceptDelta = async (
  principal: UserPrincipal,
  tx: Tx,
  delta: ConceptDelta,
): Promise<void> => {
  const workspaceId = principal.workspaceId;
  const gen = await liveGeneration(principal, tx);

  const mapped = await tx.query(
    "SELECT 1 FROM graph_node WHERE workspace_id = $1 AND gen = $2 AND uid = $3",
    [workspaceId, gen, delta.iri],
  );
  const isNew = mapped.rowCount === 0;

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
  // The from-side kind is read off the citing concept's node — every landed concept has
  // one — so a successor's own kind change relabels here too, not only a deprecation.
  await tx.query(
    `UPDATE graph_edge SET label = CASE
        WHEN $4 AND EXISTS (SELECT 1 FROM graph_node n
                             WHERE n.workspace_id = $1 AND n.gen = $2
                               AND n.uid = graph_edge.from_uid AND n.kind = $5)
        THEN '${SUPERSEDES_LABEL}' ELSE '${DERIVED_FROM_LABEL}' END
      WHERE workspace_id = $1 AND gen = $2 AND to_uid = $3
        AND label IN ('${SUPERSEDES_LABEL}', '${DERIVED_FROM_LABEL}')`,
    [workspaceId, gen, delta.iri, delta.status === CONCEPT_DEPRECATED_STATUS, delta.kind],
  );
  await replaceOutgoingEdges(principal, gen, tx, delta);

  if (!isNew) return;
  // The concepts whose files name the landed one, by its filename in link-target
  // position: each is re-derived whole, through the same one derivation as its own write.
  const naming = await tx.query<EdgeSource>(
    `SELECT iri, kind, path, body, frontmatter, published_at AS "publishedAt", sensitivity, audience
       FROM concept_index
      WHERE workspace_id = $1 AND iri <> $2 AND (body ~ $3 OR frontmatter::text ~ $3)`,
    [workspaceId, delta.iri, namePattern(delta.path.split("/").at(-1) ?? delta.path)],
  );
  for (const row of naming.rows) await replaceOutgoingEdges(principal, gen, tx, row);
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
  SELECT uid, label, kind, depth, path
    FROM (SELECT uid, label, kind, depth, path FROM walk LIMIT ${GRAPH_WALK_ROW_LIMIT}) reached
   ORDER BY depth, uid`;
};
// The LIMIT sits inside the sort on purpose: Postgres evaluates a recursive CTE only as
// far as its reader pulls, so the inner cap is what stops the recursion doing unbounded
// work — an outer LIMIT above the ORDER BY would sort everything first.

const WALK_FROM = walkStatement(true);
const WALK_TO = walkStatement(false);

const walk = async (
  statement: string,
  principal: UserPrincipal,
  tx: Tx,
  uid: string,
): Promise<readonly WalkStep[]> => {
  // The rows are the steps: the statement selects exactly `WalkStep`'s fields — node
  // fields only, no edge column — which the shape test pins.
  const found = await tx.query<WalkStep>(statement, [
    principal.workspaceId,
    uid,
    readableParameter(principal),
  ]);
  return found.rows;
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
