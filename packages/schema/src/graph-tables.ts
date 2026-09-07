import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, index, integer, text, uniqueIndex } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import { SENSITIVITIES, SENSITIVITY_DEFAULT, AUDIENCE_EVERYONE } from "./concept-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The graph: two ordinary tenant tables and the one row per workspace that names its live
 * generation (ADR 0023's write model, ADR 0032's columns). Declared here, **outside
 * `drizzle.config.ts`'s `schema` path**, because the graph tables' DDL is hand-written SQL
 * in the one journal (`0016_graph-tables.sql`) — the migration-ownership test refuses a
 * generated migration that touches them — and mirrors these declarations column for column,
 * as the counters' does.
 *
 * All three are the concepts slice's (the table-ownership map): the governed write's
 * transaction is where the bundle-and-record delta lands, so the map is never behind for an
 * edit. **The graph is derived, never a source of truth** (ADR 0011): every row here is
 * reproducible from the bundle and the records, which is what T-057's rebuild-equivalence
 * test enforces.
 */

/**
 * The closed label set of the bundle-and-record partition (ADR 0032). A concept's **kind**
 * is a property column, indexed, never a label: a label is a registry, and ADR 0026's whole
 * decision is that a kind is not registered anywhere.
 */
export const GRAPH_NODE_LABELS = [
  "Concept",
  "Section",
  "Source",
  "Actor",
  "Composition",
  "Evidence",
  "CanonicalEntity",
] as const;

/** The label every concept node wears; its kind is the property beside it. */
export const CONCEPT_NODE_LABEL = "Concept" satisfies (typeof GRAPH_NODE_LABELS)[number];

/**
 * The five named edges — the platform's own bookkeeping (ADR 0026): every markdown link is
 * a `LINKS_TO`, a successor's lineage is `SUPERSEDES`, a citation is `CITES`, a source
 * entity names the concept it is by `IS_CONCEPT`, and a canonical entity's contributions
 * hang off it by `SAME_AS`. The kind of a relation is read from the sentence, never from a
 * predicate list, which is why `LINKS_TO` carries the sentence rather than a name.
 */
export const GRAPH_EDGE_LABELS = [
  "LINKS_TO",
  "SUPERSEDES",
  "CITES",
  "IS_CONCEPT",
  "SAME_AS",
] as const;

export const LINKS_TO_LABEL = "LINKS_TO" satisfies (typeof GRAPH_EDGE_LABELS)[number];
export const SUPERSEDES_LABEL = "SUPERSEDES" satisfies (typeof GRAPH_EDGE_LABELS)[number];

/**
 * The prefix a source-entity label wears (ADR 0032: "prefixed source-entity labels"), so a
 * source-entity type that shares a kind's word never collides with a closed label. The
 * closed set *inside* the prefix arrives with the lift that writes source entities (B7);
 * until then the prefix is the whole rule, and it holds only where `gen IS NULL` — source
 * entities carry no generation, because they are reconciled per document rather than
 * rebuilt (ADR 0023).
 */
export const SOURCE_ENTITY_LABEL_PREFIX = "source-entity:";

/**
 * A partition's label rule, written from the closed lists so the CHECK and the constant
 * cannot drift: the closed set wherever, and the prefixed source-entity form only on a row
 * with no generation.
 */
const labelCheck = (labels: readonly string[]): string =>
  `label IN (${listed(labels)}) OR (gen IS NULL AND label LIKE '${SOURCE_ENTITY_LABEL_PREFIX}%')`;

/**
 * What a node and an edge carry alike, built fresh per table because a drizzle column
 * builder belongs to one table: the tenant, the partition stamp (`gen` — NULL on a source
 * entity, which has none), the key and the label; and the three visibility columns the
 * read predicate tests, exactly as `concept_index` and every `index.chunk` row carry them
 * (ADR 0023's amendment; ADR 0032) — columns and fail-closed defaults only, because the
 * derivation cascade, the audience representation and the per-kind floor are T-055's.
 */
const graphRowColumns = () => ({
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  gen: integer("gen"),
  uid: text("uid").notNull(),
  label: text("label").notNull(),
});

const visibilityColumns = () => ({
  publishedAt: stamp("published_at"),
  sensitivity: text("sensitivity").notNull().default(SENSITIVITY_DEFAULT),
  audience: text("audience").notNull().default(AUDIENCE_EVERYONE),
});

/**
 * The two partitions' keys, on nodes and edges alike (ADR 0032): unique
 * `(workspace_id, gen, uid)` on the bundle-and-record rows — so a full rebuild writes the
 * next generation *beside* the live one — and `(workspace_id, uid)` on source entities,
 * which carry no `gen` to tell two rows apart by.
 */
const partitionKeys = (
  prefix: "graph_node" | "graph_edge",
  table: Readonly<Record<"workspaceId" | "gen" | "uid", AnyPgColumn>>,
) => [
  uniqueIndex(`${prefix}_bundle_uidx`)
    .on(table.workspaceId, table.gen, table.uid)
    .where(sql`gen IS NOT NULL`),
  uniqueIndex(`${prefix}_source_entity_uidx`)
    .on(table.workspaceId, table.uid)
    .where(sql`gen IS NULL`),
];

/**
 * The **live generation** row per workspace (`CONTEXT.md`, *generation*): the stamp every
 * bundle-and-record read binds, created by the first delta that needs it and **flipped by
 * one row update** after a full rebuild. Generations exist for full rebuilds only — an
 * ordinary edit's delta lands in the live generation inside the act's own transaction and
 * mints nothing (ADR 0023); there is no record watermark, no debounce and no *updating*
 * phrase, because the map is never behind for an edit.
 */
export const graphGeneration = withRLS(
  "graph_generation",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspace.id, { onDelete: "cascade" }),
    liveGen: integer("live_gen").notNull(),
  },
  "workspaceId",
  () => [check("graph_generation_live_gen_check", sql.raw("live_gen > 0"))],
);

/**
 * A node of the map. Its key is never text (ADR 0023): `uid` renders the keyed identity —
 * a concept by its IRI, a section by `(IRI, slug)`, an actor by its actor id — and the two
 * partial unique indexes are the two partitions' keys.
 */
export const graphNode = withRLS(
  "graph_node",
  {
    ...graphRowColumns(),
    /** The concept's kind — a property, indexed, never a label (ADR 0026, ADR 0032). */
    kind: text("kind"),
    ...visibilityColumns(),
  },
  "workspaceId",
  (table) => [
    ...partitionKeys("graph_node", table),
    index("graph_node_kind_idx").on(table.workspaceId, table.kind),
    check("graph_node_label_check", sql.raw(labelCheck(GRAPH_NODE_LABELS))),
    check("graph_node_sensitivity_check", sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
  ],
);

/**
 * An edge of the map. Endpoints are uids, **deliberately without a key to `graph_node`**:
 * a markdown link to a concept that has not been written yet is legal ("not-yet-written
 * knowledge", `docs/okf-v02.md`), so an edge may dangle — the walk joins nodes, and a path
 * through a missing endpoint is simply no path, which is the fail-closed reading.
 *
 * `from_kind`, `to_kind`, `section` and `sentence` are `LINKS_TO`'s columns alone (ADR
 * 0026: a link carries its two kinds, the section and the sentence around it), held by a
 * CHECK so a named edge cannot smuggle prose.
 */
export const graphEdge = withRLS(
  "graph_edge",
  {
    ...graphRowColumns(),
    fromUid: text("from_uid").notNull(),
    toUid: text("to_uid").notNull(),
    fromKind: text("from_kind"),
    /** The target's kind as the index holds it; NULL while the target is not on the map. */
    toKind: text("to_kind"),
    section: text("section"),
    sentence: text("sentence"),
    ...visibilityColumns(),
  },
  "workspaceId",
  (table) => [
    ...partitionKeys("graph_edge", table),
    // The two ends, indexed for the traversal templates' expansion in either direction.
    index("graph_edge_from_idx").on(table.workspaceId, table.fromUid),
    index("graph_edge_to_idx").on(table.workspaceId, table.toUid),
    check("graph_edge_label_check", sql.raw(labelCheck(GRAPH_EDGE_LABELS))),
    check("graph_edge_sensitivity_check", sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
    check(
      "graph_edge_links_to_check",
      sql.raw(
        `label = 'LINKS_TO' OR (from_kind IS NULL AND to_kind IS NULL AND section IS NULL AND sentence IS NULL)`,
      ),
    ),
  ],
);
