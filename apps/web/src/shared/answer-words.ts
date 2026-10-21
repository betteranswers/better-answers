import type { FEEDBACK_REASONS, JudgeState, QuestionVerdict } from "@better-answers/schema";

const VERDICT_WORDS = {
  ok: "Answered",
  warn: "Answered with a warning",
  refuse: "Not answered",
  related: "Related knowledge",
} as const satisfies Readonly<Record<QuestionVerdict, string>>;

export const verdictWords = (verdict: QuestionVerdict | null): string =>
  verdict === null ? "Not finished" : VERDICT_WORDS[verdict];

export const JUDGE_WORDS = {
  "not-judged": "Not judged",
  judged: "Judged",
  "judging-failed": "Judging failed",
} as const satisfies Readonly<Record<JudgeState, string>>;

export type FlagReason = (typeof FEEDBACK_REASONS)[number];

export const REASON_WORDS = {
  wrong: "Wrong",
  "out-of-date": "Out of date",
  incomplete: "Incomplete",
  "should-not-have-shown": "Should not have shown",
} as const satisfies Readonly<Record<FlagReason, string>>;

export const flaggedWords = (reason: FlagReason | null): string =>
  reason === null ? "Flagged" : `Flagged · ${REASON_WORDS[reason]}`;

export const RECORD_WORDS = {
  questionGone: "Question no longer kept",
  markedHelpful: "Marked helpful",
  terms: { given: "Given", note: "Note", disputed: "Sentence Disputed" },
} as const;

export const questionWords = (record: { readonly question: string | null }): string =>
  record.question ?? RECORD_WORDS.questionGone;

export const FLAG_REASONS = [
  "wrong",
  "out-of-date",
  "incomplete",
  "should-not-have-shown",
] as const satisfies readonly FlagReason[];
