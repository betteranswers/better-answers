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

import { listed, versionChecks, versionColumns } from "./column-helpers.ts";
import { attachedByIri } from "./concept-tables.ts";
import { guideExpectedFact, guideSection } from "./guide-tables.ts";
import { readableRecordColumns, readableUnitChecks } from "./readable-columns.ts";
import { withRLS } from "./with-rls.ts";

export const WRITE_UP_HOMES = ["section", "response"] as const;

const WRITE_UP_SECTION_HOME = "section" satisfies (typeof WRITE_UP_HOMES)[number];

const WRITE_UP_RESPONSE_HOME = "response" satisfies (typeof WRITE_UP_HOMES)[number];

export const NEEDS_REVIEW_REASONS = [
  "concept-changed",
  "concept-removed",
  "expectation-unmet",
  "review-finding",
] as const;

export const writeUp = withRLS(
  "write_up",
  {
    ...readableRecordColumns(),
    home: text("home").notNull(),
    guideId: text("guide_id"),
    sectionId: text("section_id"),
    questionId: text("question_id"),
    needsReview: text("needs_review"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    ...readableUnitChecks("write_up"),
    check(
      "write_up_home_check",
      sql.raw(
        `(home = '${WRITE_UP_SECTION_HOME}' AND guide_id IS NOT NULL AND section_id IS NOT NULL AND question_id IS NULL) OR (home = '${WRITE_UP_RESPONSE_HOME}' AND question_id IS NOT NULL AND guide_id IS NULL AND section_id IS NULL)`,
      ),
    ),
    check(
      "write_up_needs_review_check",
      sql.raw(`needs_review IS NULL OR needs_review IN (${listed(NEEDS_REVIEW_REASONS)})`),
    ),
    foreignKey({
      columns: [table.workspaceId, table.guideId, table.sectionId],
      foreignColumns: [guideSection.workspaceId, guideSection.guideId, guideSection.id],
      name: "write_up_section_fk",
    }),
    uniqueIndex("write_up_section_uidx")
      .on(table.workspaceId, table.guideId, table.sectionId)
      .where(sql.raw(`home = '${WRITE_UP_SECTION_HOME}'`)),
  ],
);

export const writeUpInclude = withRLS(
  "write_up_include",
  {
    workspaceId: text("workspace_id").notNull(),
    writeUpId: text("write_up_id").notNull(),
    id: text("id").notNull(),
    ordinal: integer("ordinal").notNull(),

    iri: text("iri").notNull(),
    contentHash: text("content_hash").notNull(),
    expectedFactId: text("expected_fact_id"),
    wordingHeading: text("wording_heading"),
    wordingHash: text("wording_hash"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.writeUpId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.writeUpId],
      foreignColumns: [writeUp.workspaceId, writeUp.id],
      name: "write_up_include_write_up_fk",
    }).onDelete("cascade"),

    attachedByIri(table, "write_up_include_identity_fk"),

    foreignKey({
      columns: [table.workspaceId, table.expectedFactId],
      foreignColumns: [guideExpectedFact.workspaceId, guideExpectedFact.id],
      name: "write_up_include_expected_fact_fk",
    }),

    index("write_up_include_workspace_id_iri_idx").on(table.workspaceId, table.iri),
    index("write_up_include_workspace_id_expected_fact_id_idx").on(
      table.workspaceId,
      table.expectedFactId,
    ),
    check("write_up_include_ordinal_check", sql.raw("ordinal >= 0")),
    check(
      "write_up_include_wording_check",
      sql.raw("(wording_heading IS NULL) = (wording_hash IS NULL)"),
    ),
  ],
);

export const writeUpVersion = withRLS(
  "write_up_version",
  {
    workspaceId: text("workspace_id").notNull(),
    writeUpId: text("write_up_id").notNull(),
    ...versionColumns(),
    markdown: text("markdown").notNull(),
    includes: jsonb("includes").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.writeUpId, table.version] }),
    foreignKey({
      columns: [table.workspaceId, table.writeUpId],
      foreignColumns: [writeUp.workspaceId, writeUp.id],
      name: "write_up_version_write_up_fk",
    }),
    ...versionChecks("write_up_version"),
  ],
);
