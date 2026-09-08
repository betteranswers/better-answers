import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, index, integer, text, uniqueIndex } from "drizzle-orm/pg-core";

import { listed } from "./column-helpers.ts";
import { AUDIENCE_CHECK, readableUnitColumns, SENSITIVITIES } from "./concept-tables.ts";
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
 * `LINKS_TO` — everything the company asserts between concepts — and the **five named
 * edges** (ADR 0026's 2026-08-30 amendment): `SUPERSEDES`, `CITES` and `IS_CONCEPT` about
 * concepts; `DERIVED_FROM` and `SAME_AS` about the platform's own bookkeeping —
 * `DERIVED_FROM` carries trust lineage (ADR 0019) and `SAME_AS` hangs a contribution off a
 * canonical entity. The kind of a relation is read from the sentence, never from a
 * predicate list, which is why `LINKS_TO` carries the sentence rather than a name.
 */
export const GRAPH_EDGE_LABELS = [
  "LINKS_TO",
  "SUPERSEDES",
  "CITES",
  "IS_CONCEPT",
  "DERIVED_FROM",
  "SAME_AS",
] as const;

export const LINKS_TO_LABEL = "LINKS_TO" satisfies (typeof GRAPH_EDGE_LABELS)[number];
export const SUPERSEDES_LABEL = "SUPERSEDES" satisfies (typeof GRAPH_EDGE_LABELS)[number];
export const DERIVED_FROM_LABEL = "DERIVED_FROM" satisfies (typeof GRAPH_EDGE_LABELS)[number];

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
 * The label rules, written from the closed lists so the CHECK and the constant cannot
 * drift — and deliberately asymmetric between the tables. A **node**'s label names its
 * partition both ways: a closed label is a bundle-and-record row and carries `gen`, the
 * prefixed form is a source entity and carries none — so a closed-label node can never
 * escape a rebuild's flip by dropping its generation. An **edge**'s closed set is admitted
 * in either partition, because the source-entity partition's own edges wear closed labels:
 * `IS_CONCEPT` resolves a source entity to a concept and `SAME_AS` hangs a contribution
 * off a canonical entity (ADR 0026's 2026-08-30 amendment), reconciled per document
 * rather than rebuilt (ADR 0023) — only the prefix is tied to the missing `gen`.
 */
const nodeLabelCheck = `(gen IS NOT NULL AND label IN (${listed(GRAPH_NODE_LABELS)})) OR (gen IS NULL AND label LIKE '${SOURCE_ENTITY_LABEL_PREFIX}%')`;

const edgeLabelCheck = `label IN (${listed(GRAPH_EDGE_LABELS)}) OR (gen IS NULL AND label LIKE '${SOURCE_ENTITY_LABEL_PREFIX}%')`;

/** A generation counts from 1, as `live_gen` does; NULL is the source-entity partition's. */
const genCheck = "gen IS NULL OR gen > 0";

/**
 * What a node and an edge carry alike, built fresh per table because a drizzle column
 * builder belongs to one table: the tenant, the partition stamp (`gen` — NULL on a source
 * entity, which has none), the key and the label; and the three visibility columns the
 * read predicate tests, exactly as `concept_index` and every `index.chunk` row carry them
 * (ADR 0023's amendment; ADR 0032) — the audience as its word and its group-id array (ADR
 * 0039), with fail-closed defaults. The rows are copies: the governed write's delta writes
 * them from the index row, and the derivation's recompute rewrites them in the same
 * transaction as the index row it moved, or the walk would fork from `concept_index`.
 */
const graphRowColumns = () => ({
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  gen: integer("gen"),
  uid: text("uid").notNull(),
  label: text("label").notNull(),
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
    ...readableUnitColumns(),
  },
  "workspaceId",
  (table) => [
    ...partitionKeys("graph_node", table),
    index("graph_node_kind_idx").on(table.workspaceId, table.kind),
    check("graph_node_label_check", sql.raw(nodeLabelCheck)),
    check("graph_node_gen_check", sql.raw(genCheck)),
    check("graph_node_sensitivity_check", sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
    check("graph_node_audience_check", sql.raw(AUDIENCE_CHECK)),
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
    ...readableUnitColumns(),
  },
  "workspaceId",
  (table) => [
    ...partitionKeys("graph_edge", table),
    // The two ends, indexed for the traversal templates' expansion in either direction.
    index("graph_edge_from_idx").on(table.workspaceId, table.fromUid),
    index("graph_edge_to_idx").on(table.workspaceId, table.toUid),
    check("graph_edge_label_check", sql.raw(edgeLabelCheck)),
    check("graph_edge_gen_check", sql.raw(genCheck)),
    check("graph_edge_sensitivity_check", sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
    check("graph_edge_audience_check", sql.raw(AUDIENCE_CHECK)),
    check(
      "graph_edge_links_to_check",
      sql.raw(
        `label = 'LINKS_TO' OR (from_kind IS NULL AND to_kind IS NULL AND section IS NULL AND sentence IS NULL)`,
      ),
    ),
  ],
);
