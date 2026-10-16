import type { JudgeState, QuestionVerdict } from "@better-answers/schema";

import { JUDGE_WORDS, REASON_WORDS } from "@/shared/answer-words.ts";

import type { Phase } from "./ask-api.ts";

/** How one collection's drafted part ended, `drafted` apart: it says nothing of itself. */
type Unwritten = "refused" | "failed" | "paused";

export const ASK_WORDS = {
  lead: { before: "Ask a question, or ", link: "connect Claude", after: " to ask from there." },
  heading: "New Question",
  question: "Question",
  questionNeeded: "Please enter a question.",
  ask: "Ask",
  collections: "Collections",
  collectionsHelp: "Tick none to ask across every collection.",
  phase: {
    reading: "Reading this workspace’s knowledge.",
    judging: "Checking which Answers fit your question.",
    drafting: "Drafting from the related knowledge.",
  } satisfies Readonly<Record<Phase, string>>,
  verdictHeading: {
    ok: "Answered",
    warn: "Answered with a Warning",
    refuse: "Not Answered",
    related: "Related Knowledge",
  } satisfies Readonly<Record<QuestionVerdict, string>>,
  verdictSaid: {
    ok: "Answered from this workspace’s knowledge.",
    warn: "Answered from this workspace’s knowledge, with a warning.",
    refuse: "Not answered from the company's knowledge.",
    related: "No Answer fits your question as asked, so here is the related knowledge.",
  } satisfies Readonly<Record<QuestionVerdict, string>>,
  judge: JUDGE_WORDS satisfies Readonly<Record<JudgeState, string>>,
  noCollection: "No Collection",
  unmapped: "Unmapped Passages",
  unwritten: {
    refused: "Nothing was drafted, because no sentence could cite this knowledge.",
    failed: "Nothing was drafted. Please try again.",
    paused: "Drafting is paused because this workspace has reached its monthly AI spending limit.",
  } satisfies Readonly<Record<Unwritten, string>>,
  cites: (title: string): string => `Cites ${title}`,
  helpful: "Mark as Helpful",
  markedHelpful: "Marked Helpful",
  helpfulSaid: "Your feedback has been sent successfully.",
  flag: "Flag",
  flagAnswer: "Flag This Answer",
  flagOf: (words: string): string => `Flag “${words}”`,
  flagged: "Flagged",
  flagSaid: "Your flag has been sent successfully.",
  reason: "Reason",
  reasonNeeded: "Please choose a reason.",
  reasons: REASON_WORDS,
  note: "Note",
  noteHelp: "Optional. Say what was wrong.",
  sendFlag: "Send Flag",
} as const;
