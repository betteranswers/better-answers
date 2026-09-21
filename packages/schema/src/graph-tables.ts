import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, index, integer, text, uniqueIndex } from "drizzle-orm/pg-core";

import { listed } from "./column-helpers.ts";
import { AUDIENCE_CHECK, readableUnitColumns, SENSITIVITIES } from "./readable-columns.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const GRAPH_NODE_LABELS = [
  "Concept",
  "Section",
  "Source",
  "Actor",
  "Composition",
  "Evidence",
  "CanonicalEntity",
] as const;

export const CONCEPT_NODE_LABEL = "Concept" satisfies (typeof GRAPH_NODE_LABELS)[number];

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

export const SOURCE_ENTITY_LABEL_PREFIX = "source-entity:";

const nodeLabelCheck = `(gen IS NOT NULL AND label IN (${listed(GRAPH_NODE_LABELS)})) OR (gen IS NULL AND label LIKE '${SOURCE_ENTITY_LABEL_PREFIX}%')`;

const edgeLabelCheck = `label IN (${listed(GRAPH_EDGE_LABELS)}) OR (gen IS NULL AND label LIKE '${SOURCE_ENTITY_LABEL_PREFIX}%')`;

const genCheck = "gen IS NULL OR gen > 0";

const graphRowColumns = () => ({
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  gen: integer("gen"),
  uid: text("uid").notNull(),
  label: text("label").notNull(),
});

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

export const graphNode = withRLS(
  "graph_node",
  {
    ...graphRowColumns(),

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

export const graphEdge = withRLS(
  "graph_edge",
  {
    ...graphRowColumns(),
    fromUid: text("from_uid").notNull(),
    toUid: text("to_uid").notNull(),
    fromKind: text("from_kind"),

    toKind: text("to_kind"),
    section: text("section"),
    sentence: text("sentence"),
    ...readableUnitColumns(),
  },
  "workspaceId",
  (table) => [
    ...partitionKeys("graph_edge", table),

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
