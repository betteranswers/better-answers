import { flaggedWords, JUDGE_WORDS, RECORD_WORDS, verdictWords } from "@/shared/answer-words.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";

import type { AskedRecord, ConceptRead, FlagClosing } from "./questions-api.ts";

const JUDGED_WORDS = {
  yes: "Yes, it answers the question",
  no: "No, it does not answer the question",
} as const satisfies Readonly<Record<NonNullable<ConceptRead["judged"]>, string>>;

const WHERE_WORDS = {
  mcp: "Through an assistant",
  trpc: "On the Ask page",
} as const satisfies Readonly<Record<AskedRecord["transport"], string>>;

const CLOSING_WORDS = {
  "fixed-in-the-knowledge": "Fixed in the knowledge",
  "no-fault-in-the-knowledge": "Knowledge was correct",
} as const satisfies Readonly<Record<FlagClosing, string>>;

export const CLOSE_AS = {
  "fixed-in-the-knowledge": "Fixed in the Knowledge",
  "no-fault-in-the-knowledge": "Knowledge Was Correct",
} as const satisfies Readonly<Record<FlagClosing, string>>;

export const CLOSINGS = [
  "fixed-in-the-knowledge",
  "no-fault-in-the-knowledge",
] as const satisfies readonly FlagClosing[];

const ASKER_WORDS = {
  "former-member": "A former member",
  platform: "The platform",
} as const satisfies Readonly<Record<Exclude<AskedRecord["askedBy"]["kind"], "person">, string>>;

export const QUESTIONS_WORDS = {
  heading: "Questions Asked",
  loading: "The questions are still loading.",
  none: "No questions yet",
  selectFirst: "Please select a question first.",
  flagged: "Flagged",
  others: "Other Questions",
  notAnswered: "Not Answered",
  noCollection: CONCEPT_WORDS.noCollection,
  more: "More Questions",
  verdict: verdictWords,
  judge: (state: AskedRecord["judgeState"]): string =>
    state === null ? "Not finished" : JUDGE_WORDS[state],
  judged: JUDGED_WORDS,
  where: WHERE_WORDS,
  asker: ASKER_WORDS,
  closing: CLOSING_WORDS,
  flaggedAs: flaggedWords,
  terms: {
    askedBy: "Asked By",
    asked: "Asked",
    where: "Where",
    collectionsNamed: "Collections Chosen",
    verdict: "Verdict",
    judge: "Judge",
    conceptType: "Type",
    collection: "Collection",
    trust: "Trust",
    judged: "Judge’s Verdict",
    ...RECORD_WORDS.terms,
    restedOn: "Cited Concept",
    closed: "Closed",
  },
  noneNamed: "None",
  parts: {
    answer: "Answer",
    concepts: "Concepts",
    drafted: "Drafted Answer",
    feedback: "Feedback",
  },
  noConcepts: "No concepts you have access to",
  helpful: RECORD_WORDS.markedHelpful,
  closeTheFlag: "Close This Flag",
  closedSaid: {
    "fixed-in-the-knowledge": "The flag has been closed as fixed in the knowledge.",
    "no-fault-in-the-knowledge": "The flag has been closed. The knowledge was correct.",
  } satisfies Readonly<Record<FlagClosing, string>>,
} as const;
