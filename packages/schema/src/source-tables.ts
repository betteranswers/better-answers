import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import { readableRecordColumns, readableUnitChecks, SENSITIVITIES } from "./readable-columns.ts";
import { withRLS } from "./with-rls.ts";

export const CONNECTORS = ["upload"] as const;

export const CONNECTOR_UPLOAD = "upload" satisfies (typeof CONNECTORS)[number];

export const DESTINATIONS = ["chunk-index", "bundle", "graph"] as const;

export const UPLOAD_DESTINATIONS = ["chunk-index", "bundle"] as const;

export const RETENTION_CLASSES = ["mirror", "keep", "transient"] as const;

export const RETENTION_CLASS_DEFAULT = "keep" satisfies (typeof RETENTION_CLASSES)[number];

export const BINDING_STATES = ["landed", "indexing", "indexed", "published"] as const;

export const BINDING_LANDED_STATE = "landed" satisfies (typeof BINDING_STATES)[number];

export const BINDING_INDEXING_STATE = "indexing" satisfies (typeof BINDING_STATES)[number];

export const BINDING_INDEXED_STATE = "indexed" satisfies (typeof BINDING_STATES)[number];

export const BINDING_PUBLISHED_STATE = "published" satisfies (typeof BINDING_STATES)[number];

export const DOCUMENT_OUTCOMES = ["converted", "quarantined"] as const;

export const DOCUMENT_CONVERTED_OUTCOME = "converted" satisfies (typeof DOCUMENT_OUTCOMES)[number];

export const DOCUMENT_QUARANTINED_OUTCOME =
  "quarantined" satisfies (typeof DOCUMENT_OUTCOMES)[number];

export const QUARANTINE_ERROR = /^\S+$/u;

export const RULES_IN_FORCE_KEYS = ["default_on", "default_off"] as const;

export const RULES_IN_FORCE_DEFAULT = { default_on: true, default_off: false } as const;

const rulesInForceIsShaped = [
  `jsonb_typeof(rules_in_force) = 'object'`,
  ...RULES_IN_FORCE_KEYS.map(
    (key) => `jsonb_typeof(rules_in_force -> '${key}') IS NOT DISTINCT FROM 'boolean'`,
  ),
].join("\n         AND ");

const destinationIsAKnownSet = `cardinality(destination) > 0
         AND array_position(destination, NULL) IS NULL
         AND destination <@ ARRAY[${listed(DESTINATIONS)}]::text[]`;

export const sourceBinding = withRLS(
  "source_binding",

  {
    ...readableRecordColumns(),

    name: text("name").notNull(),

    connector: text("connector").notNull(),

    destination: text("destination")
      .array()
      .notNull()
      .default([...UPLOAD_DESTINATIONS]),

    retentionClass: text("retention_class").notNull().default(RETENTION_CLASS_DEFAULT),

    state: text("state").notNull().default(BINDING_LANDED_STATE),

    rulesInForce: jsonb("rules_in_force").notNull().default(RULES_IN_FORCE_DEFAULT),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    ...readableUnitChecks("source_binding"),
    check("source_binding_rules_in_force_check", sql.raw(rulesInForceIsShaped)),

    check("source_binding_connector_check", sql.raw(`connector IN (${listed(CONNECTORS)})`)),
    check("source_binding_destination_check", sql.raw(destinationIsAKnownSet)),
    check(
      "source_binding_retention_class_check",
      sql.raw(`retention_class IN (${listed(RETENTION_CLASSES)})`),
    ),

    check("source_binding_state_check", sql.raw(`state IN (${listed(BINDING_STATES)})`)),
  ],
);

export const sourceDocument = withRLS(
  "source_document",
  {
    workspaceId: text("workspace_id").notNull(),

    id: text("id").notNull(),
    bindingId: text("binding_id").notNull(),

    sourceSystemId: text("source_system_id").notNull(),

    title: text("title").notNull(),

    mediaType: text("media_type").notNull(),

    byteSize: integer("byte_size").notNull(),

    originalKey: text("original_key").notNull(),
    normalisedKey: text("normalised_key"),

    contentHash: text("content_hash"),

    redactionVersion: text("redaction_version"),

    firstSeen: stamp("first_seen").notNull().defaultNow(),
    lastSeen: stamp("last_seen").notNull().defaultNow(),

    lastModified: stamp("last_modified"),

    goneAt: stamp("gone_at"),

    outcome: text("outcome"),

    quarantineError: text("quarantine_error"),

    sensitivity: text("sensitivity"),

    // Kept apart from the seam's verdict it is folded with, so a lifted verdict returns the
    // document to the Admin's narrowing and never past it.
    narrowedTo: text("narrowed_to"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),

    foreignKey({
      columns: [table.workspaceId, table.bindingId],
      foreignColumns: [sourceBinding.workspaceId, sourceBinding.id],
      name: "source_document_binding_fk",
    }).onDelete("cascade"),

    index("source_document_workspace_id_binding_id_idx").on(table.workspaceId, table.bindingId),

    uniqueIndex("source_document_workspace_id_binding_id_source_system_id_uidx").on(
      table.workspaceId,
      table.bindingId,
      table.sourceSystemId,
    ),

    check(
      "source_document_outcome_check",
      sql.raw(`outcome IS NULL OR outcome IN (${listed(DOCUMENT_OUTCOMES)})`),
    ),
    check(
      "source_document_sensitivity_check",
      sql.raw(`sensitivity IS NULL OR sensitivity IN (${listed(SENSITIVITIES)})`),
    ),
    check(
      "source_document_narrowed_to_check",
      sql.raw(
        `narrowed_to IS NULL
         OR (sensitivity IS NOT NULL
             AND narrowed_to IN (${listed(SENSITIVITIES)})
             AND public.narrower_class(sensitivity, narrowed_to) = sensitivity)`,
      ),
    ),

    check(
      "source_document_quarantine_error_check",
      sql.raw(
        "quarantine_error IS NULL OR outcome IS NOT DISTINCT FROM" +
          ` '${DOCUMENT_QUARANTINED_OUTCOME}'`,
      ),
    ),

    check("source_document_byte_size_check", sql.raw("byte_size >= 0")),
  ],
);
