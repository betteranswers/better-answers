import { dayWords } from "@/shared/words.ts";

import type { AskedRecord, ConceptRead, Feedback, FlagClosing } from "./questions-api.ts";

type Verdict = NonNullable<AskedRecord["verdict"]>;

/** Related knowledge is never called an answer, so its word says only what it is. */
const VERDICT_WORDS = {
  ok: "Answered",
  warn: "Answered with a warning",
  refuse: "Not answered",
  related: "Related knowledge",
} as const satisfies Readonly<Record<Verdict, string>>;

const JUDGE_WORDS = {
  "not-judged": "Not judged",
  judged: "Judged",
  "judging-failed": "Judging failed",
} as const satisfies Readonly<Record<NonNullable<AskedRecord["judgeState"]>, string>>;

const JUDGED_WORDS = {
  yes: "Yes, it answers the question",
  no: "No, it does not answer the question",
} as const satisfies Readonly<Record<NonNullable<ConceptRead["judged"]>, string>>;

const WHERE_WORDS = {
  mcp: "Through an assistant",
  trpc: "On the Ask page",
} as const satisfies Readonly<Record<AskedRecord["transport"], string>>;

const REASON_WORDS = {
  wrong: "Wrong",
  "out-of-date": "Out of date",
  incomplete: "Incomplete",
  "should-not-have-shown": "Should not have shown",
} as const satisfies Readonly<Record<NonNullable<Feedback["reason"]>, string>>;

const CLOSING_WORDS = {
  "fixed-in-the-knowledge": "Fixed in the knowledge",
  "no-fault-in-the-knowledge": "No fault in the knowledge",
} as const satisfies Readonly<Record<FlagClosing, string>>;

/** The control's own label, in a button's casing. */
export const CLOSE_AS = {
  "fixed-in-the-knowledge": "Fixed in the Knowledge",
  "no-fault-in-the-knowledge": "No Fault in the Knowledge",
} as const satisfies Readonly<Record<FlagClosing, string>>;

/** The order the two closings are offered in. */
export const CLOSINGS = [
  "fixed-in-the-knowledge",
  "no-fault-in-the-knowledge",
] as const satisfies readonly FlagClosing[];

const STATUS_WORDS: ReadonlyMap<string, string> = new Map([
  ["changed-since-checked", "Changed since verified"],
  ["out-of-date", "Out of date"],
  ["draft", "Draft"],
  ["deprecated", "Deprecated"],
]);

const RIDER_WORDS: ReadonlyMap<string, string> = new Map([
  ["imported", " · imported"],
  ["source-moved-on", " · source moved on"],
]);

type TrustThen = ConceptRead["trustThen"];

/** A record never keeps who verified a concept, so a person's verification names none. */
const verifiedWords = (trust: TrustThen): string => {
  const rider = trust.rider === null ? "" : (RIDER_WORDS.get(trust.rider) ?? "");
  switch (trust.tier) {
    case "human-reviewed": {
      const day = trust.verifiedAt === null ? "" : ` · ${dayWords(trust.verifiedAt)}`;
      return `Verified by a person${day}${rider}`;
    }
    case "machine-confirmed":
      return `Verified automatically${rider}`;
    default:
      return "Unverified";
  }
};

/** The trust words a concept wore when the question was asked. */
export const trustThenWords = (trust: TrustThen): string =>
  STATUS_WORDS.get(trust.status) ?? verifiedWords(trust);

/** The glossary's words for an asker the record cannot name, set at the start of a line. */
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
  noCollection: "No collection",
  more: "More Questions",
  removed: "Question removed by an erasure",
  verdict: (verdict: AskedRecord["verdict"]): string =>
    verdict === null ? "Not finished" : VERDICT_WORDS[verdict],
  judge: (state: AskedRecord["judgeState"]): string =>
    state === null ? "Not finished" : JUDGE_WORDS[state],
  judged: JUDGED_WORDS,
  where: WHERE_WORDS,
  asker: ASKER_WORDS,
  closing: CLOSING_WORDS,
  flaggedAs: (reason: Feedback["reason"]): string =>
    reason === null ? "Flagged" : `Flagged · ${REASON_WORDS[reason]}`,
  terms: {
    askedBy: "Asked By",
    asked: "Asked",
    where: "Where",
    collectionsNamed: "Collections Named",
    verdict: "Verdict",
    judge: "Judge",
    kind: "Kind",
    collection: "Collection",
    trustThen: "Trust When Asked",
    judged: "Judge’s Verdict",
    note: "Note",
    disputed: "Sentence Disputed",
    restedOn: "Rested On",
    given: "Given",
    closed: "Closed",
  },
  noneNamed: "None",
  parts: {
    answer: "Answer",
    concepts: "Concepts",
    drafted: "Drafted Prose",
    feedback: "Feedback",
  },
  noConcepts: "No concepts you can read",
  helpful: "Marked helpful",
  closeTheFlag: "Close This Flag",
  closedSaid: {
    "fixed-in-the-knowledge": "The flag has been closed as fixed in the knowledge successfully.",
    "no-fault-in-the-knowledge":
      "The flag has been closed as no fault in the knowledge successfully.",
  } satisfies Readonly<Record<FlagClosing, string>>,
} as const;
