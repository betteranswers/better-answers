import { counted, instantWords } from "@/shared/words.ts";

import type { ListedConnectedSource, Sensitivity } from "./sources-api.ts";

export { instantWords };

/** Said when a row's keystroke is pressed and no connected source has held focus. */
export const SELECT_A_CONNECTED_SOURCE_FIRST = "Select a connected source first.";

type Meaning = { readonly word: string; readonly means: string };

export const STATE_WORDS = {
  received: "Received",
  indexing: "Indexing",
  indexed: "Indexed",
  published: "Published",
} satisfies Record<ListedConnectedSource["state"], string>;

export const STATE_MEANS = {
  received: "Its documents have been received; no sync has turned them into passages yet.",
  indexing: "A sync is turning its documents into passages.",
  indexed: "The sync has finished and there is something to review.",
  published: "Its passages reach the readers in its audience.",
} satisfies Record<ListedConnectedSource["state"], string>;

export const CONNECTOR_WORDS = {
  upload: "Upload",
} satisfies Record<ListedConnectedSource["connector"], string>;

/** Each says its effect before the click; the row adds its source's name for a screen reader. */
export const ROW_ACTIONS = {
  review: "Review findings",
  publish: "Publish",
  narrow: "Narrow sensitivity",
  widen: "Widen sensitivity or audience",
} as const;

type Sync = NonNullable<ListedConnectedSource["lastSync"]>;

const SYNC_SAYS = {
  queued: "Sync queued",
  claimed: "Syncing",
  failed: "Sync failed",
  poisoned: "Sync failed",
} satisfies Record<Exclude<Sync["status"], "done">, string>;

/** How a dismissal's line ends: where the sync that reads it has got to. */
export const SYNC_OF_A_DISMISSAL = {
  queued: "is queued",
  claimed: "is running",
  done: "has finished",
  failed: "failed",
  poisoned: "failed",
} satisfies Record<Sync["status"], string>;

/** The Last synced row: a finished sync's time alone, and any other sync's state before its time. */
export const lastSyncedWords = (lastSync: Sync | null): string => {
  if (lastSync === null) return "Not synced yet";
  const when = instantWords(lastSync.finishedAt ?? lastSync.enqueuedAt);
  return lastSync.status === "done" ? when : `${SYNC_SAYS[lastSync.status]} · ${when}`;
};

export const AUDIENCE_WORDS = {
  everyone: "Everyone in the workspace",
  groups: "Named groups",
} satisfies Record<ListedConnectedSource["audience"], string>;

/** The empty list's one line: the toolbar's Connect a document is how a document is connected. */
export const NOTHING_CONNECTED = "No document is connected yet.";

/** One term over every destination's sentence, however many a connected source feeds. */
export const DESTINATIONS_TERM = "Destinations";

const DESTINATIONS = new Map<string, Meaning>([
  [
    "passage-index",
    {
      word: "searchable",
      means: "Its passages are found by search and opened by the readers it is published to.",
    },
  ],
  [
    "bundle",
    {
      word: "knowledge base",
      means:
        "Concepts drawn from it arrive as suggestions an Admin accepts, once extraction finishes.",
    },
  ],
  ["map", { word: "map", means: "The people, meetings and tasks it names join the map." }],
]);

const RETENTIONS = new Map<string, Meaning>([
  [
    "mirror",
    {
      word: "mirror",
      means:
        "The source holds the record; a document gone at source loses its passages after a grace period.",
    },
  ],
  [
    "keep",
    {
      word: "keep",
      means: "The platform holds the record; nothing leaves without an Admin’s action.",
    },
  ],
  [
    "transient",
    {
      word: "transient",
      means: "The original is deleted once processed; the normalised redacted text is kept.",
    },
  ],
]);

/** A word the vocabulary has not met stands where its sentence would, so it is shown, not dropped. */
const meaningIn = (vocabulary: ReadonlyMap<string, Meaning>, word: string): Meaning =>
  vocabulary.get(word) ?? { word, means: word };

export const destinationOf = (word: string): Meaning => meaningIn(DESTINATIONS, word);

export const retentionOf = (word: string): Meaning => meaningIn(RETENTIONS, word);

/**
 * The api's cap, stated not imported: the web takes nothing from the api at runtime, and the api
 * refuses a larger file alike.
 */
export const UPLOAD_CAP_MB = 64;

export const NEEDS_OCR = "NeedsOcrError";

const UNREADABLE_WORDS = new Map([
  [NEEDS_OCR, "needs OCR"],
  ["DeadlineExceededError", "took too long"],
]);

export const unreadableWordOf = (error: string): string =>
  UNREADABLE_WORDS.get(error) ?? "could not be read";

/** OCR is named only where a document needs it: an Admin weighing OCR reads the count. */
export const unreadableCounted = (unreadable: number, needingOcr: number): string => {
  const all = `${counted(unreadable, "document", "documents")} unreadable.`;
  return needingOcr === 0
    ? all
    : `${all} ${counted(needingOcr, "is a scan that needs", "are scans that need")} OCR.`;
};

/** The publish row carries one count per category the seam can raise, a zero included. */
export const AUDITED_CATEGORIES = [
  "special-category",
  "bank-details",
  "government-identifier",
  "date-of-birth",
  "home-address",
  "personal-contact",
  "person-name",
  "job-title",
] as const;

/** A category's or a tier's word is kebab-case on the row and spaced on the page. */
export const spokenWord = (word: string): string => word.replaceAll("-", " ");

/** Where the word stands alone, as a table's cell does, it opens with a capital. */
export const sentenceCased = (word: string): string => {
  const spoken = spokenWord(word);
  return spoken.charAt(0).toUpperCase() + spoken.slice(1);
};

/** The ids the worker's redaction descriptors raise. */
const RULE_WORDS = new Map([
  ["HEALTH_CUE", "Health wording"],
  ["UK_BANK_ACCOUNT", "Sort code and account number"],
  ["UK_NHS", "NHS number"],
  ["UK_NINO", "National Insurance number"],
  ["DATE_OF_BIRTH", "Date of birth"],
  ["UK_HOME_ADDRESS", "Home address"],
  ["EMAIL_ADDRESS", "Personal email address"],
  ["PHONE_NUMBER", "Phone number"],
  ["PERSON", "Person’s name"],
  ["JOB_TITLE", "Job title"],
]);

/** A rule the list has not met reads as its id. */
export const ruleWordOf = (ruleId: string): string => RULE_WORDS.get(ruleId) ?? ruleId;

export type SensitivityAndAudience = {
  readonly sensitivity: Sensitivity;
  readonly audience: ListedConnectedSource["audience"];
};

export const sensitivityAndAudienceWords = (terms: SensitivityAndAudience): string =>
  `${terms.sensitivity} for ${AUDIENCE_WORDS[terms.audience].toLowerCase()}`;

const fromTo = (from: string, to: string): string => `From ${from} to ${to}`;

type Change = { readonly term: string; readonly says: string };

/** A term that stays where it is has nothing to say, so it is left off the list. */
export const termsThatChange = (
  present: SensitivityAndAudience,
  asked: SensitivityAndAudience,
): readonly Change[] => [
  ...(present.sensitivity === asked.sensitivity
    ? []
    : [{ term: "Sensitivity", says: fromTo(present.sensitivity, asked.sensitivity) }]),
  ...(present.audience === asked.audience
    ? []
    : [
        {
          term: "Audience",
          says: fromTo(
            AUDIENCE_WORDS[present.audience].toLowerCase(),
            AUDIENCE_WORDS[asked.audience].toLowerCase(),
          ),
        },
      ]),
];

const ITS_OWN_SENSITIVITY_STANDS = "A document with a narrower sensitivity of its own keeps it.";

/** A narrowing's or a widening's inline panel: its name, its consequence and its commit. */
export const SENSITIVITY_PANEL_WORDS = {
  narrow: {
    named: (name: string): string => `Narrow the sensitivity of ${name}`,
    consequence: (): string =>
      "Every concept citing its documents, and every write-up including one of those concepts, moves with it in the same action. A narrowing never widens; widening it back is an action of its own.",
    commit: (name: string, asked: SensitivityAndAudience): string =>
      `Narrow ${name} to ${asked.sensitivity}`,
  },
  widen: {
    named: (name: string): string => `Widen the sensitivity or audience of ${name}`,
    consequence: (published: boolean): string =>
      `${
        published
          ? "Its passages reach more readers the moment you widen it, and every concept citing its documents, and every write-up including one, moves with it in the same action."
          : "Nobody but an Admin reads it until you publish it, and the publish then releases the sensitivity you choose here."
      } ${ITS_OWN_SENSITIVITY_STANDS}`,
    commit: (name: string, asked: SensitivityAndAudience): string =>
      `Widen ${name} to ${sensitivityAndAudienceWords(asked)}`,
  },
} as const;

/** Said beside a commit that waits on the narrowing or widening sent before it. */
export const THE_CHANGE_BEFORE_IS_STILL_GOING =
  "The change before this one is still going. Try again once it answers.";

/** Said when a review is asked to open or close while a bulk action waits on its answer. */
export const THE_ACTION_BEFORE_IS_STILL_GOING =
  "The action before this one is still going. Try again once it answers.";

export const groupsCounted = (groups: number): string =>
  counted(groups, "group of findings", "groups of findings");

const findingsCounted = (findings: number): string => counted(findings, "finding", "findings");

type NamedGroup = {
  readonly category: string;
  readonly ruleId: string;
  readonly title: string;
};

export const REVIEW_WORDS = {
  heading: (name: string): string => `Review of ${name}`,
  lead: "What the last sync found, per category and rule, counted. No value is shown: the three actions take a group of findings, never what it found.",
  /** While no group is ticked, the one line that says what enables the three actions. */
  selectFirst: "Select a group of findings first.",
  select: (group: NamedGroup): string =>
    `Select ${spokenWord(group.category)} by ${ruleWordOf(group.ruleId)} in ${group.title}`,
  noPassages: "This connected source has no passages yet.",
  alreadyNarrowed: {
    tag: "Already narrowed",
    says: "A special category finding narrowed this document.",
  },
  dismissed: {
    tag: "Dismissed",
    says: (findings: number): string =>
      `${findingsCounted(findings)} as not special category. A dismissed finding no longer narrows its document, and stays withheld unless kept in text.`,
  },
  keptStillWithheld: {
    tag: "Kept, still withheld",
    says: (findings: number): string =>
      `${counted(findings, "kept finding", "kept findings")} overridden by an erasure request: an erasure outranks a keep.`,
  },
  keep: {
    label: "Keep in text",
    named: (groups: number): string => `Keep ${groupsCounted(groups)} in text`,
    consequence:
      "Every finding of each group goes back into its document’s text on the next sync, restored under your name with this reason. An erasure request still outranks a keep.",
    pending: (groups: number): string => `Keeping ${groupsCounted(groups)} in text.`,
    done: (groups: number, findings: number): string =>
      `Kept ${groupsCounted(groups)} in text: ${findingsCounted(findings)} restored, and the sync that lets them back in is queued.`,
  },
  narrowDocuments: { label: "Narrow these documents" },
  dismiss: {
    label: "Dismiss as not special category",
    named: (groups: number): string => `Dismiss ${groupsCounted(groups)} as not special category`,
    consequence:
      "Every finding of each group is reviewed as dismissed under your name with this reason, and the sync that reads the dismissal is queued. On that sync, a document whose every special category finding is dismissed goes back to the sensitivity an Admin narrowed it to, or to its connected source’s sensitivity if none did. The findings stay withheld unless kept in text.",
  },
} as const;

export const CONNECT_WORDS = {
  consequence:
    "The connected source starts unpublished: nobody but an Admin reads a word of it until you publish it. Its sync starts once the file is received.",
  audienceHint: "Named groups cannot be chosen here yet.",
} as const;
