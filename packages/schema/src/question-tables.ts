import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, primaryKey, text } from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN } from "./actor-id.ts";
import type { DraftedSentence, RecordConcept, RecordMapState } from "./boundary-schemas.ts";
import { listed, stamp } from "./column-helpers.ts";
import { ROLES } from "./roles.ts";
import { withRLS } from "./with-rls.ts";

export const QUESTION_VERDICTS = ["ok", "warn", "refuse", "related"] as const;
export type QuestionVerdict = (typeof QUESTION_VERDICTS)[number];

export const JUDGE_STATES = ["not-judged", "judged", "judging-failed"] as const;
export type JudgeState = (typeof JUDGE_STATES)[number];

export const CANDIDATE_VERDICTS = ["yes", "no"] as const;
export type CandidateVerdict = (typeof CANDIDATE_VERDICTS)[number];

export const MAP_LIVE = "live";

export const MAP_UNAVAILABLE = "unavailable_since";

export const QUESTION_TRANSPORTS = ["mcp", "trpc"] as const;
export type QuestionTransport = (typeof QUESTION_TRANSPORTS)[number];

export const FEEDBACK_VERDICTS = ["helpful", "flag"] as const;

export const FEEDBACK_FLAG_VERDICT = "flag" satisfies (typeof FEEDBACK_VERDICTS)[number];

export const FEEDBACK_REASONS = [
  "wrong",
  "out-of-date",
  "incomplete",
  "should-not-have-shown",
] as const;

export const FLAG_CLOSINGS = ["fixed-in-the-knowledge", "no-fault-in-the-knowledge"] as const;
export type FlagClosing = (typeof FLAG_CLOSINGS)[number];

export const questionAsked = withRLS(
  "question_asked",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),

    askedAt: stamp("asked_at").notNull(),
    askedBy: text("asked_by").notNull(),
    transport: text("transport").notNull(),
    collections: text("collections").array().notNull().default([]),
    predicateRole: text("predicate_role").notNull(),
    predicateGroups: text("predicate_groups").array().notNull().default([]),

    completedAt: stamp("completed_at"),
    verdict: text("verdict"),
    judgeState: text("judge_state"),
    concepts: jsonb("concepts").$type<RecordConcept[]>().notNull().default([]),
    unmappedPassages: text("unmapped_passages").array().notNull().default([]),
    mapState: jsonb("map_state").$type<RecordMapState>(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    index("question_asked_workspace_id_asked_by_idx").on(table.workspaceId, table.askedBy),
    index("question_asked_workspace_id_asked_at_id_idx").on(
      table.workspaceId,
      table.askedAt.desc(),
      table.id.desc(),
    ),

    check("question_asked_asked_by_check", sql.raw(`asked_by ~ '^${ACTOR_ID_PATTERN}$'`)),
    check(
      "question_asked_transport_check",
      sql.raw(`transport IN (${listed(QUESTION_TRANSPORTS)})`),
    ),
    check("question_asked_predicate_role_check", sql.raw(`predicate_role IN (${listed(ROLES)})`)),
    check(
      "question_asked_verdict_check",
      sql.raw(`verdict IS NULL OR verdict IN (${listed(QUESTION_VERDICTS)})`),
    ),
    check(
      "question_asked_judge_state_check",
      sql.raw(`judge_state IS NULL OR judge_state IN (${listed(JUDGE_STATES)})`),
    ),
    check(
      "question_asked_completion_check",
      sql.raw(
        `(completed_at IS NULL) = (verdict IS NULL)
         AND (completed_at IS NULL) = (judge_state IS NULL)`,
      ),
    ),
    check("question_asked_concepts_check", sql.raw("jsonb_typeof(concepts) = 'array'")),
    check(
      "question_asked_map_state_check",
      sql.raw(
        `map_state IS NULL
         OR (completed_at IS NOT NULL
             AND (map_state = jsonb_build_object('state', '${MAP_LIVE}')
                  OR (map_state = jsonb_build_object(
                        'state', '${MAP_UNAVAILABLE}', 'since', map_state->'since')
                      AND jsonb_typeof(map_state->'since') = 'string')))`,
      ),
    ),
  ],
);

export const questionContent = withRLS(
  "question_content",
  {
    workspaceId: text("workspace_id").notNull(),
    recordId: text("record_id").notNull(),
    /** The record's own `asked_at`, repeated because a partition key sits on the row. */
    askedAt: stamp("asked_at").notNull(),

    question: text("question").notNull(),
    drafted: jsonb("drafted").$type<DraftedSentence[]>(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.recordId, table.askedAt] }),
    foreignKey({
      columns: [table.workspaceId, table.recordId],
      foreignColumns: [questionAsked.workspaceId, questionAsked.id],
      name: "question_content_record_fk",
    }),
    check(
      "question_content_drafted_check",
      sql.raw("drafted IS NULL OR jsonb_typeof(drafted) = 'array'"),
    ),
  ],
);

export const questionFeedback = withRLS(
  "question_feedback",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    recordId: text("record_id").notNull(),

    givenAt: stamp("given_at").notNull(),
    givenBy: text("given_by").notNull(),

    verdict: text("verdict").notNull(),
    reason: text("reason"),
    note: text("note"),

    disputedSentence: text("disputed_sentence"),
    disputedConcept: text("disputed_concept"),

    closedAs: text("closed_as"),
    closedAt: stamp("closed_at"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.recordId],
      foreignColumns: [questionAsked.workspaceId, questionAsked.id],
      name: "question_feedback_record_fk",
    }),
    index("question_feedback_workspace_id_record_id_idx").on(table.workspaceId, table.recordId),
    index("question_feedback_workspace_id_given_by_idx").on(table.workspaceId, table.givenBy),
    index("question_feedback_open_flag_idx")
      .on(table.workspaceId, table.recordId)
      .where(sql.raw(`verdict = '${FEEDBACK_FLAG_VERDICT}' AND closed_at IS NULL`)),

    check("question_feedback_given_by_check", sql.raw(`given_by ~ '^${ACTOR_ID_PATTERN}$'`)),
    check("question_feedback_verdict_check", sql.raw(`verdict IN (${listed(FEEDBACK_VERDICTS)})`)),
    check(
      "question_feedback_reason_check",
      sql.raw(`reason IS NULL OR reason IN (${listed(FEEDBACK_REASONS)})`),
    ),
    check(
      "question_feedback_flag_check",
      sql.raw(
        `(verdict = '${FEEDBACK_FLAG_VERDICT}') = (reason IS NOT NULL)
         AND (note IS NULL OR verdict = '${FEEDBACK_FLAG_VERDICT}')
         AND (disputed_concept IS NULL OR verdict = '${FEEDBACK_FLAG_VERDICT}')
         AND (disputed_sentence IS NULL OR disputed_concept IS NOT NULL)`,
      ),
    ),
    check(
      "question_feedback_closed_check",
      sql.raw(
        `(closed_as IS NULL) = (closed_at IS NULL)
         AND (closed_as IS NULL OR closed_as IN (${listed(FLAG_CLOSINGS)}))
         AND (closed_as IS NULL OR verdict = '${FEEDBACK_FLAG_VERDICT}')`,
      ),
    ),
  ],
);
