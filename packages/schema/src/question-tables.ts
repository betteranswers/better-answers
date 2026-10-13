import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, primaryKey, text } from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN } from "./actor-id.ts";
import { listed, stamp } from "./column-helpers.ts";
import { ROLES } from "./roles.ts";
import { withRLS } from "./with-rls.ts";

export const QUESTION_VERDICTS = ["ok", "warn", "refuse", "related"] as const;
export type QuestionVerdict = (typeof QUESTION_VERDICTS)[number];

export const JUDGE_STATES = ["not-judged", "judged", "judging-failed"] as const;
export type JudgeState = (typeof JUDGE_STATES)[number];

/** The judge's word on one candidate. */
export const CANDIDATE_VERDICTS = ["yes", "no"] as const;
export type CandidateVerdict = (typeof CANDIDATE_VERDICTS)[number];

/** Where a question was asked: through an assistant, or on the Ask page. */
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

/**
 * A record's skeleton, kept for good. `concepts` names each by IRI with no foreign key, so a
 * record outlives a concept it returned.
 */
export const questionAsked = withRLS(
  "question_asked",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),

    askedAt: stamp("asked_at").notNull(),
    /** `human:<person id>`, which an erasure rewrites to the erasure pseudonym. */
    askedBy: text("asked_by").notNull(),
    transport: text("transport").notNull(),
    collections: text("collections").array().notNull().default([]),
    /** The predicate that applied: the role and the groups the asker read under. */
    predicateRole: text("predicate_role").notNull(),
    predicateGroups: text("predicate_groups").array().notNull().default([]),

    completedAt: stamp("completed_at"),
    verdict: text("verdict"),
    judgeState: text("judge_state"),
    /** Each returned or cited concept: its IRI, its content hash and trust then, the judge's word. */
    concepts: jsonb("concepts").notNull().default([]),
    /** Locators alone: a passage's text stays in the index. */
    unmappedPassages: text("unmapped_passages").array().notNull().default([]),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    index("question_asked_workspace_id_asked_by_idx").on(table.workspaceId, table.askedBy),

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
  ],
);

/**
 * The migration partitions it by the month of `asked_at`: a month's content leaves by dropping
 * its partition, and no statement thins a row.
 */
export const questionContent = withRLS(
  "question_content",
  {
    workspaceId: text("workspace_id").notNull(),
    recordId: text("record_id").notNull(),
    /** The record's own `asked_at`, repeated because a partition key sits on the row. */
    askedAt: stamp("asked_at").notNull(),

    question: text("question").notNull(),
    /** Null unless the platform drafted: each sentence with the concepts its footnotes name. */
    drafted: jsonb("drafted"),
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
    /** As `question_asked.asked_by`, and rewritten with it. */
    givenBy: text("given_by").notNull(),

    verdict: text("verdict").notNull(),
    reason: text("reason"),
    note: text("note"),

    disputedSentence: text("disputed_sentence"),
    /** The IRI the disputed sentence rested on, with no foreign key. */
    disputedConcept: text("disputed_concept"),
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
         AND (disputed_sentence IS NULL OR verdict = '${FEEDBACK_FLAG_VERDICT}')
         AND (disputed_sentence IS NULL) = (disputed_concept IS NULL)`,
      ),
    ),
  ],
);
