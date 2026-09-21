import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, primaryKey, text } from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN, PLATFORM_ACTOR_PREFIX } from "./actor-id.ts";
import { listed, stamp } from "./column-helpers.ts";
import { conceptIdentity } from "./concept-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const SUGGESTION_KINDS = ["edit", "candidate", "promotion", "repair"] as const;

export const SUGGESTION_EDIT_KIND = "edit" satisfies (typeof SUGGESTION_KINDS)[number];

export const SUGGESTION_KINDS_FROM_THE_APP = [
  "edit",
  "promotion",
] as const satisfies readonly (typeof SUGGESTION_KINDS)[number][];

export const SUGGESTION_KINDS_FROM_A_RUN = [
  "candidate",
  "promotion",
  "repair",
] as const satisfies readonly (typeof SUGGESTION_KINDS)[number][];

export const SUGGESTION_REPAIR_KIND = "repair" satisfies (typeof SUGGESTION_KINDS)[number];

export const SUGGESTION_STATUSES = ["waiting", "accepted", "declined", "returned"] as const;

export const SUGGESTION_WAITING_STATUS = "waiting" satisfies (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_ACCEPTED_STATUS = "accepted" satisfies (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_DECLINED_STATUS = "declined" satisfies (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_RETURNED_STATUS = "returned" satisfies (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_REASON_MAX = 2000;

export const SUGGESTION_BODY_MAX = 100_000;

export const SUGGESTION_SET_MAX = 500;

export const suggestion = withRLS(
  "suggestion",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),

    setId: text("set_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default(SUGGESTION_WAITING_STATUS),

    proposer: text("proposer").notNull(),

    targetIri: text("target_iri"),

    decider: text("decider"),

    reason: text("reason"),
    proposedAt: stamp("proposed_at").notNull().defaultNow(),
    decidedAt: stamp("decided_at"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.targetIri],
      foreignColumns: [conceptIdentity.workspaceId, conceptIdentity.iri],
      name: "suggestion_target_fk",
    }),

    index("suggestion_workspace_id_set_id_idx").on(table.workspaceId, table.setId),
    check("suggestion_kind_check", sql.raw(`kind IN (${listed(SUGGESTION_KINDS)})`)),
    check("suggestion_status_check", sql.raw(`status IN (${listed(SUGGESTION_STATUSES)})`)),

    check("suggestion_proposer_check", sql.raw(`proposer ~ '^${ACTOR_ID_PATTERN}$'`)),
    check(
      "suggestion_decider_check",
      sql.raw(`decider IS NULL OR decider ~ '^${ACTOR_ID_PATTERN}$'`),
    ),

    check(
      "suggestion_repair_proposer_check",
      sql.raw(`kind <> '${SUGGESTION_REPAIR_KIND}' OR proposer LIKE '${PLATFORM_ACTOR_PREFIX}%'`),
    ),
    check(
      "suggestion_reason_length_check",
      sql.raw(`reason IS NULL OR char_length(reason) BETWEEN 1 AND ${SUGGESTION_REASON_MAX}`),
    ),

    check(
      "suggestion_decision_check",
      sql.raw(
        `(status = '${SUGGESTION_WAITING_STATUS}') = (decided_at IS NULL)
         AND (decided_at IS NULL) = (decider IS NULL)
         AND (target_iri IS NOT NULL) = (status = '${SUGGESTION_ACCEPTED_STATUS}')
         AND (reason IS NOT NULL) = (status IN ('${SUGGESTION_DECLINED_STATUS}', '${SUGGESTION_RETURNED_STATUS}'))`,
      ),
    ),
  ],
);

export const conceptWriteRequest = withRLS(
  "concept_write_request",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    suggestionId: text("suggestion_id").notNull(),

    mergeKey: text("merge_key").notNull(),
    /* jscpd:ignore-start */

    path: text("path").notNull(),

    conceptKind: text("concept_kind").notNull(),
    title: text("title").notNull(),
    frontmatter: jsonb("frontmatter").notNull(),
    body: text("body").notNull(),
    /* jscpd:ignore-end */

    baseContentHash: text("base_content_hash"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.suggestionId] }),
    foreignKey({
      columns: [table.workspaceId, table.suggestionId],
      foreignColumns: [suggestion.workspaceId, suggestion.id],
      name: "concept_write_request_suggestion_fk",
    }).onDelete("cascade"),
    check(
      "concept_write_request_body_length_check",
      sql.raw(`char_length(body) <= ${SUGGESTION_BODY_MAX}`),
    ),
  ],
);
