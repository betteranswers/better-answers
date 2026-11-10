import type { JudgeState, QuestionVerdict } from "@better-answers/schema";

import { JUDGE_WORDS, REASON_WORDS, RECORD_WORDS, verdictWords } from "@/shared/answer-words.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";

import type { Phase } from "./ask-api.ts";

type Unwritten = "refused" | "failed" | "paused";

export const ASK_WORDS = {
  question: "Question",
  questionNeeded: "Enter a question.",
  ask: "Ask",
  collections: "Collections",
  collectionsHelp: "Leave all unticked to search every collection.",
  phase: {
    reading: "Searching the knowledge base…",
    judging: "Checking which Q&A pairs answer the question…",
    drafting: "Writing an answer from related knowledge…",
  } satisfies Readonly<Record<Phase, string>>,
  verdict: verdictWords,
  verdictSaid: {
    ok: "Answered from the knowledge base.",
    warn: "Answered from the knowledge base, with a warning.",
    refuse: "Nothing in the knowledge base answers this question.",
    related: "Found related knowledge.",
  } satisfies Readonly<Record<QuestionVerdict, string>>,
  judge: JUDGE_WORDS satisfies Readonly<Record<JudgeState, string>>,
  noCollection: CONCEPT_WORDS.noCollection,
  unmapped: "Passages",
  unwritten: {
    refused: "No cited answer could be written.",
    failed: "Couldn’t write an answer. Ask the question again.",
    paused: "No answer was written. This workspace has reached its monthly AI spending limit.",
  } satisfies Readonly<Record<Unwritten, string>>,
  cites: (place: number, title: string): string => `[${String(place)}] Cites ${title}`,
  helpful: "Mark as helpful",
  markedHelpful: RECORD_WORDS.markedHelpful,
  helpfulSaid: "Feedback sent.",
  flag: "Flag",
  flagAnswer: "Flag this answer",
  flagOf: (words: string): string => `Flag “${words}”`,
  flagged: "Flagged",
  flagSaid: "Flag sent.",
  reason: "Reason",
  reasonNeeded: "Choose a reason.",
  reasons: REASON_WORDS,
  note: "Note (optional)",
  sendFlag: "Send flag",
} as const;

export const YOUR_QUESTIONS_WORDS = {
  loading: "Loading your questions…",
  none: "No questions yet",
  more: "More questions",
  recordLoading: "Loading the question…",
  feedback: "Your feedback",
} as const;
