import type { FEEDBACK_REASONS, JudgeState, QuestionVerdict } from "@better-answers/schema";

/** Related knowledge is never called an answer, so its word says only what it is. */
export const VERDICT_WORDS = {
  ok: "Answered",
  warn: "Answered with a warning",
  refuse: "Not answered",
  related: "Related knowledge",
} as const satisfies Readonly<Record<QuestionVerdict, string>>;

export const JUDGE_WORDS = {
  "not-judged": "Not judged",
  judged: "Judged",
  "judging-failed": "Judging failed",
} as const satisfies Readonly<Record<JudgeState, string>>;

export const REASON_WORDS = {
  wrong: "Wrong",
  "out-of-date": "Out of date",
  incomplete: "Incomplete",
  "should-not-have-shown": "Should not have shown",
} as const satisfies Readonly<Record<(typeof FEEDBACK_REASONS)[number], string>>;
