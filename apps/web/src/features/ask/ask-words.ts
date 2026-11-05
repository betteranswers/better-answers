import type { JudgeState, QuestionVerdict } from "@better-answers/schema";

import { JUDGE_WORDS, REASON_WORDS } from "@/shared/answer-words.ts";

import type { Phase } from "./ask-api.ts";

type Unwritten = "refused" | "failed" | "paused";

export const ASK_WORDS = {
  lead: {
    before: "Ask a question, or ",
    link: "connect Claude",
    after: " to ask questions from Claude.",
  },
  heading: "New Question",
  question: "Question",
  questionNeeded: "Please enter a question.",
  ask: "Ask",
  collections: "Collections",
  collectionsHelp: "Leave every box unticked to search all collections.",
  phase: {
    reading: "Searching this workspace’s knowledge.",
    judging: "Checking which Q&A pairs answer your question.",
    drafting: "Writing an answer from related knowledge.",
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
    related: "No Q&A pair answers your question, so here is related knowledge.",
  } satisfies Readonly<Record<QuestionVerdict, string>>,
  judge: JUDGE_WORDS satisfies Readonly<Record<JudgeState, string>>,
  noCollection: "No Collection",
  unmapped: "Passages Not in the Knowledge Base",
  unwritten: {
    refused:
      "No answer was written, because no sentence could be checked against the knowledge below.",
    failed: "There was a problem writing an answer. Please try again.",
    paused:
      "No answer was written, because this workspace has reached its monthly AI spending limit.",
  } satisfies Readonly<Record<Unwritten, string>>,
  cites: (place: number, title: string): string => `[${String(place)}] Cites ${title}`,
  helpful: "Mark as Helpful",
  markedHelpful: "Marked Helpful",
  helpfulSaid: "Your feedback has been sent.",
  flag: "Flag",
  flagAnswer: "Flag This Answer",
  flagOf: (words: string): string => `Flag “${words}”`,
  flagged: "Flagged",
  flagSaid: "Your flag has been sent.",
  reason: "Reason",
  reasonNeeded: "Please choose a reason.",
  reasons: REASON_WORDS,
  note: "Note",
  noteHelp: "Optional. Tell us what was wrong.",
  sendFlag: "Send Flag",
} as const;

export const YOUR_QUESTIONS_WORDS = {
  loading: "Your questions are still loading.",
  none: "No questions yet",
  more: "More Questions",
  recordLoading: "The question is still loading.",
  feedback: "Your Feedback",
} as const;
