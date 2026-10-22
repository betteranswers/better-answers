import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

import { listed, stamp, versionChecks, versionColumns } from "./column-helpers.ts";
import { attachedByIri, COLLECTION, TRUST_TIERS } from "./concept-tables.ts";
import { ROLES } from "./roles.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const GUIDE_LAYERS = ["assembled", "quoted"] as const;

export const ROLE_LABELS = ["know", "say", "show", "do"] as const;

export const guideDefinition = withRLS(
  "guide_definition",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    template: text("template").notNull(),
    kind: text("kind").notNull(),
    collection: text("collection").notNull(),
    subjectIri: text("subject_iri"),
    createdAt: stamp("created_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    attachedByIri(
      { workspaceId: table.workspaceId, iri: table.subjectIri },
      "guide_definition_subject_fk",
    ),
    check("guide_definition_collection_check", sql.raw(`collection ~ '${COLLECTION.source}'`)),
  ],
);

export const guideRole = withRLS(
  "guide_role",
  {
    workspaceId: text("workspace_id").notNull(),
    guideId: text("guide_id").notNull(),
    role: text("role").notNull(),
    defaultLayer: text("default_layer").notNull(),
    actionThreshold: text("action_threshold").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.guideId, table.role] }),
    foreignKey({
      columns: [table.workspaceId, table.guideId],
      foreignColumns: [guideDefinition.workspaceId, guideDefinition.id],
      name: "guide_role_guide_fk",
    }).onDelete("cascade"),
    check("guide_role_role_check", sql.raw(`role IN (${listed(ROLES)})`)),
    check("guide_role_default_layer_check", sql.raw(`default_layer IN (${listed(GUIDE_LAYERS)})`)),
    check(
      "guide_role_action_threshold_check",
      sql.raw(`action_threshold IN (${listed(TRUST_TIERS)})`),
    ),
  ],
);

export const guideSection = withRLS(
  "guide_section",
  {
    workspaceId: text("workspace_id").notNull(),
    guideId: text("guide_id").notNull(),
    id: text("id").notNull(),
    parentId: text("parent_id"),
    ordinal: integer("ordinal").notNull(),
    prompt: text("prompt").notNull(),
    roleLabel: text("role_label").notNull(),
    usageNote: text("usage_note"),
    layers: text("layers").array().notNull(),
    hidden: boolean("hidden").notNull().default(false),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.guideId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.guideId],
      foreignColumns: [guideDefinition.workspaceId, guideDefinition.id],
      name: "guide_section_guide_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.guideId, table.parentId],
      foreignColumns: [table.workspaceId, table.guideId, table.id],
      name: "guide_section_parent_fk",
    }).onDelete("cascade"),
    check("guide_section_ordinal_check", sql.raw("ordinal >= 0")),
    check("guide_section_role_label_check", sql.raw(`role_label IN (${listed(ROLE_LABELS)})`)),
    check(
      "guide_section_layers_check",
      sql.raw(`cardinality(layers) > 0 AND layers <@ ARRAY[${listed(GUIDE_LAYERS)}]::text[]`),
    ),
  ],
);

export const guideExpectedFact = withRLS(
  "guide_expected_fact",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    guideId: text("guide_id").notNull(),
    sectionId: text("section_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    tags: text("tags").array().notNull().default([]),
    collection: text("collection"),
    atLeast: integer("at_least").notNull().default(1),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.guideId, table.sectionId],
      foreignColumns: [guideSection.workspaceId, guideSection.guideId, guideSection.id],
      name: "guide_expected_fact_section_fk",
    }).onDelete("cascade"),
    index("guide_expected_fact_workspace_id_guide_id_section_id_idx").on(
      table.workspaceId,
      table.guideId,
      table.sectionId,
    ),
    check("guide_expected_fact_ordinal_check", sql.raw("ordinal >= 0")),
    check("guide_expected_fact_tags_check", sql.raw("array_position(tags, NULL) IS NULL")),
    check(
      "guide_expected_fact_collection_check",
      sql.raw(`collection IS NULL OR collection ~ '${COLLECTION.source}'`),
    ),
    check("guide_expected_fact_at_least_check", sql.raw("at_least >= 1")),
  ],
);

export const guideDefinitionVersion = withRLS(
  "guide_definition_version",
  {
    workspaceId: text("workspace_id").notNull(),
    guideId: text("guide_id").notNull(),
    ...versionColumns(),
    content: jsonb("content").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.guideId, table.version] }),
    foreignKey({
      columns: [table.workspaceId, table.guideId],
      foreignColumns: [guideDefinition.workspaceId, guideDefinition.id],
      name: "guide_definition_version_guide_fk",
    }),
    ...versionChecks("guide_definition_version"),
  ],
);
