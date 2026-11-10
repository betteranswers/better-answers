import { counted, instantWords } from "@/shared/words.ts";

import type { ListedConnectedSource, Sensitivity } from "./sources-api.ts";

export { instantWords };

export const SELECT_A_CONNECTED_SOURCE_FIRST = "Select a connected source first.";

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

export const NOTHING_CONNECTED = "No connected sources yet. Connect a document to start.";

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
  { category: "special-category", term: "Special category findings" },
  { category: "bank-details", term: "Bank details findings" },
  { category: "government-identifier", term: "Government identifier findings" },
  { category: "date-of-birth", term: "Date of birth findings" },
  { category: "home-address", term: "Home address findings" },
  { category: "personal-contact", term: "Personal contact findings" },
  { category: "person-name", term: "Person name findings" },
  { category: "job-title", term: "Job title findings" },
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

export const SENSITIVITY_PANEL_WORDS = {
  narrow: {
    named: (name: string): string => `Narrow the sensitivity of ${name}`,
    commit: "Narrow",
    pending: "Narrowing.",
  },
  widen: {
    named: (name: string): string => `Widen the sensitivity or audience of ${name}`,
    commit: "Widen",
    pending: "Widening.",
  },
} as const;

export const PUBLISH_PENDING = "Publishing.";

export const THE_CHANGE_BEFORE_IS_STILL_GOING = "Wait for the previous change to finish.";

export const THE_ACTION_BEFORE_IS_STILL_GOING = "Wait for the previous action to finish.";

export const groupsCounted = (groups: number): string =>
  counted(groups, "group of findings", "groups of findings");

const findingsCounted = (findings: number): string => counted(findings, "finding", "findings");

const documentsCounted = (documents: number): string => counted(documents, "document", "documents");

type Cited = { readonly concepts: number; readonly writeUps: number };

const citedWords = (cited: Cited): string =>
  `${counted(cited.concepts, "concept", "concepts")} and ${counted(cited.writeUps, "write-up", "write-ups")}`;

type NamedGroup = RuleOfAGroup & { readonly title: string };

export const REVIEW_WORDS = {
  heading: (name: string): string => `Review of ${name}`,
  selectFirst: "Select a group of findings first.",
  select: (group: NamedGroup): string =>
    `Select ${spokenWord(group.category)} findings in ${group.title} found by the ${ruleWordOf(group)} rule`,
  tier: (tier: string): string => `Redaction: ${sentenceCased(tier)}`,
  noPassages: "No passages yet",
  preview: {
    label: "Preview passages",
    lead: "Passages as readers see them once you publish.",
  },
  alreadyNarrowed: {
    tag: "Already narrowed",
    says: "This document holds special category data.",
  },
  dismissed: {
    tag: "Dismissed",
    says: (findings: number): string =>
      `${findingsCounted(findings)} dismissed as not special category.`,
  },
  keptStillWithheld: {
    tag: "Still withheld",
    says: (findings: number): string =>
      `${findingsCounted(findings)} kept in text and withheld by an erasure request.`,
  },
  keep: {
    label: "Keep in text",
    named: (groups: number): string => `Keep ${groupsCounted(groups)} in text`,
    consequence: "The findings show in the text after the next sync.",
    pending: "Keeping in text.",
    done: (groups: number, findings: number): string =>
      `${groupsCounted(groups)} kept in text. ${findingsCounted(findings)} show after the next sync.`,
  },
  narrowDocuments: {
    label: "Narrow these documents",
    named: (documents: number, sensitivity: string): string =>
      `Narrow ${documentsCounted(documents)} to ${sensitivity}`,
    consequence: "You can’t undo this.",
    commit: "Narrow",
    pending: "Narrowing.",
    done: (documents: number, sensitivity: string, cited: Cited): string =>
      `${documentsCounted(documents)} narrowed to ${sensitivity}. ${citedWords(cited)} that cite them were also updated.`,
  },
  dismiss: {
    label: "Dismiss as not special category",
    named: (groups: number): string => `Dismiss ${groupsCounted(groups)} as not special category`,
    consequence:
      "Documents with no other special category findings go back to their earlier sensitivity after the next sync.",
    pending: "Dismissing.",
    done: (groups: number, documents: number): string =>
      `${groupsCounted(groups)} dismissed in ${documentsCounted(documents)}.`,
    sync: (status: string): string => `The sync that applies the change ${status}.`,
  },
} as const;

export const CONNECT_WORDS = {
  action: "Connect a document",
  consequence: "You review and publish it after it syncs.",
  connected: (name: string, fileName: string): string =>
    `“${name}” connected. ${fileName} is queued to sync.`,
} as const;

export const LIST_WORDS = {
  more: "More details",
  lastSynced: "Last synced",
} as const;

export const OUTCOME_WORDS = {
  alreadyPublished: (name: string): string => `“${name}” is already published.`,
  publishAfterSync: (name: string): string => `“${name}” can be published once its sync finishes.`,
  already: (name: string, what: string): string => `“${name}” is already ${what}.`,
  narrowed: (name: string, sensitivity: string): string => `“${name}” narrowed to ${sensitivity}.`,
  widened: (name: string, what: string): string => `“${name}” widened to ${what}.`,
  published: (name: string, what: string): string => `“${name}” published as ${what}.`,
  cited: (cited: Cited): string => `${citedWords(cited)} that cite it were also updated.`,
} as const;

export const PUBLISH_WORDS = {
  named: (name: string): string => `Publish ${name}`,
  consequence: (what: string): string => `It will be published as ${what}. You can’t undo this.`,
  confirmations: {
    lawfulBasisRecorded: "Lawful basis recorded",
    privacyInformationUpdated: "Privacy information updated",
    dpiaReferenced: "DPIA reference recorded",
  },
  confirm: "Confirm before publishing",
  allRequired: "Tick all three confirmations to publish.",
  audit: "Audit log entry",
  connectedSource: "Connected source",
  dpiaInput: "DPIA input",
} as const;
