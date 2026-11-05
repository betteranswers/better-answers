import { counted, instantWords } from "@/shared/words.ts";

import type { ListedConnectedSource, Sensitivity } from "./sources-api.ts";

export { instantWords };

export const SELECT_A_CONNECTED_SOURCE_FIRST = "Please select a connected source first.";

export const STATE_WORDS = {
  received: "Received",
  indexing: "Indexing",
  indexed: "Indexed",
  published: "Published",
} satisfies Record<ListedConnectedSource["state"], string>;

export const STATE_MEANS = {
  received: "Received and waiting to sync.",
  indexing: "A sync is running.",
  indexed: "Synced and ready to review.",
  published: "Published to its audience.",
} satisfies Record<ListedConnectedSource["state"], string>;

export const CONNECTOR_WORDS = {
  upload: "Upload",
} satisfies Record<ListedConnectedSource["connector"], string>;

export const ROW_ACTIONS = {
  review: "Review Findings",
  publish: "Publish",
  narrow: "Narrow Sensitivity",
  widen: "Widen Sensitivity or Audience",
} as const;

type Sync = NonNullable<ListedConnectedSource["lastSync"]>;

const SYNC_SAYS = {
  queued: "Sync queued",
  claimed: "Syncing",
  failed: "Sync failed",
  poisoned: "Sync failed",
} satisfies Record<Exclude<Sync["status"], "done">, string>;

export const SYNC_OF_A_DISMISSAL = {
  queued: "is queued",
  claimed: "is running",
  done: "has finished",
  failed: "failed",
  poisoned: "failed",
} satisfies Record<Sync["status"], string>;

export const lastSyncedWords = (lastSync: Sync | null): string => {
  if (lastSync === null) return "Not synced yet";
  const when = instantWords(lastSync.finishedAt ?? lastSync.enqueuedAt);
  return lastSync.status === "done" ? when : `${SYNC_SAYS[lastSync.status]} · ${when}`;
};

export const AUDIENCE_WORDS = {
  everyone: "Everyone in the workspace",
  groups: "Named groups",
} satisfies Record<ListedConnectedSource["audience"], string>;

const AUDIENCE_IN_A_SENTENCE = {
  everyone: "everyone in the workspace",
  groups: "named groups",
} satisfies Record<ListedConnectedSource["audience"], string>;

export const NOTHING_CONNECTED = "No connected sources yet";

export const DESTINATIONS_TERM = "Destinations";

export const DESTINATION_MEANS = {
  "passage-index": "Its passages appear in search.",
  bundle: "Concepts from it are suggested to an Admin.",
  map: "Its people, meetings and tasks are added to the map.",
} satisfies Record<ListedConnectedSource["destination"][number], string>;

export const RETENTION_MEANS = {
  mirror: "Documents removed at source are removed here after a grace period.",
  keep: "Documents are kept until an Admin removes them.",
  transient: "Originals are deleted once processed. The redacted text is kept.",
} satisfies Record<ListedConnectedSource["retentionClass"], string>;

export const UPLOAD_CAP_MB = 64;

export const NEEDS_OCR = "NeedsOcrError";

const UNREADABLE_WORDS = new Map([
  [NEEDS_OCR, "needs OCR"],
  ["DeadlineExceededError", "took too long"],
]);

export const unreadableWordOf = (error: string): string =>
  UNREADABLE_WORDS.get(error) ?? "could not be read";

export const unreadableCounted = (unreadable: number, needingOcr: number): string => {
  const all = `${counted(unreadable, "document", "documents")} could not be read.`;
  return needingOcr === 0
    ? all
    : `${all} ${counted(needingOcr, "is a scan that needs", "are scans that need")} OCR.`;
};

export const AUDITED_CATEGORIES = [
  { category: "special-category", term: "Special Category Findings" },
  { category: "bank-details", term: "Bank Details Findings" },
  { category: "government-identifier", term: "Government Identifier Findings" },
  { category: "date-of-birth", term: "Date of Birth Findings" },
  { category: "home-address", term: "Home Address Findings" },
  { category: "personal-contact", term: "Personal Contact Findings" },
  { category: "person-name", term: "Person Name Findings" },
  { category: "job-title", term: "Job Title Findings" },
] as const;

export const spokenWord = (word: string): string => word.replaceAll("-", " ");

export const sentenceCased = (word: string): string => {
  const spoken = spokenWord(word);
  return spoken.charAt(0).toUpperCase() + spoken.slice(1);
};

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

type RuleOfAGroup = { readonly category: string; readonly ruleId: string };

export const ruleWordOf = (group: RuleOfAGroup): string =>
  RULE_WORDS.get(group.ruleId) ?? sentenceCased(group.category);

export type SensitivityAndAudience = {
  readonly sensitivity: Sensitivity;
  readonly audience: ListedConnectedSource["audience"];
};

export const sensitivityAndAudienceWords = (terms: SensitivityAndAudience): string =>
  `${terms.sensitivity} for ${AUDIENCE_IN_A_SENTENCE[terms.audience]}`;

const fromTo = (from: string, to: string): string => `From ${from} to ${to}`;

type Change = { readonly term: string; readonly says: string };

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
            AUDIENCE_IN_A_SENTENCE[present.audience],
            AUDIENCE_IN_A_SENTENCE[asked.audience],
          ),
        },
      ]),
];

const NARROWER_DOCUMENTS_STAY = "Narrower documents stay as they are.";

const WHAT_CITES_IT_FOLLOWS = "Concepts and write-ups that cite it are updated too.";

export const SENSITIVITY_PANEL_WORDS = {
  narrow: {
    named: (name: string): string => `Narrow the Sensitivity of ${name}`,
    consequence: (): string => `This limits who can read it. ${WHAT_CITES_IT_FOLLOWS}`,
    commit: "Narrow",
    pending: "Narrowing.",
  },
  widen: {
    named: (name: string): string => `Widen the Sensitivity or Audience of ${name}`,
    consequence: (published: boolean): string =>
      `${
        published
          ? `More people will be able to read it straight away. ${WHAT_CITES_IT_FOLLOWS}`
          : "Only Admins can read it until you publish it."
      } ${NARROWER_DOCUMENTS_STAY}`,
    commit: "Widen",
    pending: "Widening.",
  },
} as const;

export const PUBLISH_PENDING = "Publishing.";

export const THE_CHANGE_BEFORE_IS_STILL_GOING = "Please wait for the previous change to finish.";

export const THE_ACTION_BEFORE_IS_STILL_GOING = "Please wait for the previous action to finish.";

export const groupsCounted = (groups: number): string =>
  counted(groups, "group of findings", "groups of findings");

const groupsCountedInATitle = (groups: number): string =>
  counted(groups, "Group of Findings", "Groups of Findings");

const findingsCounted = (findings: number): string => counted(findings, "finding", "findings");

type NamedGroup = RuleOfAGroup & { readonly title: string };

export const REVIEW_WORDS = {
  heading: (name: string): string => `Review of ${name}`,
  lead: "These findings come from the last sync. The personal data itself is never shown.",
  selectFirst: "Select a group of findings first.",
  select: (group: NamedGroup): string =>
    `Select ${spokenWord(group.category)} findings in ${group.title} found by the ${ruleWordOf(group)} rule`,
  tier: (tier: string): string => `Redaction: ${sentenceCased(tier)}`,
  noPassages: "No passages yet",
  alreadyNarrowed: {
    tag: "Already narrowed",
    says: "This document was narrowed because it contains special category data.",
  },
  dismissed: {
    tag: "Dismissed",
    says: (findings: number): string =>
      `${findingsCounted(findings)} dismissed as not special category.`,
  },
  keptStillWithheld: {
    tag: "Still withheld",
    says: (findings: number): string =>
      `${findingsCounted(findings)} kept in text, but still withheld because of an erasure request.`,
  },
  keep: {
    label: "Keep in Text",
    named: (groups: number): string => `Keep ${groupsCountedInATitle(groups)} in Text`,
    consequence:
      "These findings will be shown in the text after the next sync. Your reason will be recorded.",
    pending: "Keeping in text.",
    done: (groups: number, findings: number): string =>
      `${groupsCounted(groups)} kept in text successfully. ${findingsCounted(findings)} will be shown after the next sync.`,
  },
  narrowDocuments: { label: "Narrow These Documents" },
  dismiss: {
    label: "Dismiss as Not Special Category",
    named: (groups: number): string =>
      `Dismiss ${groupsCountedInATitle(groups)} as Not Special Category`,
    consequence:
      "These findings stay withheld. A document with no other special category findings returns to its earlier sensitivity after the next sync. Your reason will be recorded.",
  },
} as const;

export const CONNECT_WORDS = {
  consequence: "Only Admins can read it until you publish it.",
  audienceHint: "Named groups cannot be chosen here yet.",
} as const;
