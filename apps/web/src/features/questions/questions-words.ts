import { flaggedWords, JUDGE_WORDS, RECORD_WORDS, verdictWords } from "@/shared/answer-words.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";

import type { AskedRecord, ConceptRead, FlagClosing } from "./questions-api.ts";

const JUDGED_WORDS = {
  yes: "Yes",
  no: "No",
} as const satisfies Readonly<Record<NonNullable<ConceptRead["judged"]>, string>>;

const WHERE_WORDS = {
  mcp: "Through an assistant",
  trpc: "On the Ask page",
} as const satisfies Readonly<Record<AskedRecord["transport"], string>>;

const CLOSING_WORDS = {
  "fixed-in-the-knowledge": "Fixed in the knowledge",
  "no-fault-in-the-knowledge": "Knowledge was correct",
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
  loading: "Loading questions…",
  none: "No questions yet",
  selectFirst: "Select a question first.",
  flagged: "Flagged",
  others: "Other questions",
  notAnswered: verdictWords("refuse"),
  noCollection: CONCEPT_WORDS.noCollection,
  more: "More questions",
  verdict: verdictWords,
  judge: (state: AskedRecord["judgeState"]): string =>
    state === null ? "Not finished" : JUDGE_WORDS[state],
  judged: JUDGED_WORDS,
  where: WHERE_WORDS,
  asker: ASKER_WORDS,
  closing: CLOSING_WORDS,
  flaggedAs: flaggedWords,
  terms: {
    askedBy: "Asked by",
    asked: "Asked",
    where: "Where",
    collectionsNamed: "Collections chosen",
    verdict: "Verdict",
    judge: "Judge",
    conceptType: "Type",
    collection: "Collection",
    trust: "Trust",
    judged: "Answers the question",
    ...RECORD_WORDS.terms,
    restedOn: "Cited concept",
    closed: "Closed",
  },
  noneNamed: "All collections",
  parts: {
    answer: "Answer",
    concepts: "Concepts",
    drafted: "Drafted answer",
    feedback: "Feedback",
  },
  noConcepts: "No concepts you can read.",
  helpful: RECORD_WORDS.markedHelpful,
  closeTheFlag: "Close this flag",
  closedSaid: {
    "fixed-in-the-knowledge": "Flag closed as fixed in the knowledge.",
    "no-fault-in-the-knowledge": "Flag closed. The knowledge was correct.",
  } satisfies Readonly<Record<FlagClosing, string>>,
} as const;

export const ANSWER_TESTS_WORDS = {
  empty: "No answer tests yet",
} as const;
