import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import { guideTitleOf } from "@/shared/knowledge/guide-title.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { GuideSummary, RecordsExported } from "../knowledge-api.ts";

const conceptsCounted = (count: number): string => counted(count, "concept", "concepts");

export const ALL_KNOWLEDGE_WORDS = {
  about:
    "Every concept you can read, with its owner and who last verified it. An Admin can set the owner of several concepts at once.",
  caption: "Every concept you can read, with its kind, collection, owner and last verification.",
  loading: "The knowledge base is still loading.",
  none: "No concepts in the knowledge base yet. A concept appears here once it is saved.",
  noneMatch: "No concepts match these filters.",
  count: conceptsCounted,
  matching: (count: number): string =>
    count === 1 ? "1 concept matches these filters." : `${count} concepts match these filters.`,
  columns: {
    title: "Title",
    kind: "Kind",
    collection: "Collection",
    trust: "Trust",
    owner: "Owner",
    checked: "Last Verified",
  },
  noCollection: CONCEPT_WORDS.noCollection,
  unowned: "No owner yet",
  unnamed: "Unnamed member",
  ownOwner: "Set for this concept only",
  notChecked: "Not verified yet",
  checkedBy: (by: string): string => `by ${by}`,
  filters: {
    collection: { label: "Collection", any: "Any Collection", yours: "Collections You Own" },
    kind: { label: "Kind", any: "Any Kind" },
  },
  selected: "Selected concepts",
  everyOnThePage: "Select every concept on this page",
  selectFirst: "Please select a concept first.",
  pages: "Pages of Concepts",
  setOwner: {
    action: "Set Owner",
    title: (count: number): string => `Set the Owner of ${counted(count, "Concept", "Concepts")}`,
    consequence:
      "The person you choose becomes the owner of each selected concept, instead of its collection’s owner. Choose “Its collection’s owner” to undo this. Each change is recorded in the audit log.",
    newOwner: "New Owner",
    choose: "Choose a person",
    collectionsOwner: "Its collection’s owner",
    pending: (name: string, count: number): string =>
      `Setting ${name} as the owner of ${conceptsCounted(count)}.`,
    done: (name: string, count: number): string => `${name} now owns ${conceptsCounted(count)}.`,
    returning: (count: number): string =>
      `Returning ${conceptsCounted(count)} to ${count === 1 ? "its collection’s owner" : "their collections’ owners"}.`,
    returned: (count: number): string =>
      `${conceptsCounted(count)} ${count === 1 ? "is now owned by its collection’s owner" : "are now owned by their collections’ owners"}.`,
    stillGoing: "The owner is still being set. Please wait.",
    tooMany: (most: number): string => `Please select ${most} concepts or fewer.`,
  },
  refusedOnRead: {
    "owner-forbids": "You no longer own any collections, so you can’t view this page.",
    "role-forbids": "You don’t have permission to view this page.",
  } satisfies OwnSentences,
  refusedOnSetOwner: {
    "owner-forbids": "You no longer own any collections, so you can’t view this page.",
    "role-forbids": "You don’t have permission to set the owner of concepts.",
    "no-such-member":
      "That person is no longer a member of this workspace. Please choose someone else.",
    "no-such-concept":
      "One of the selected concepts is no longer available. No owners were changed. Please reload the page and try again.",
    malformed: "Please select between 1 and 200 concepts and choose a person.",
  } satisfies OwnSentences,
} as const;

const kindsCounted = (count: number): string => counted(count, "kind", "kinds");

export const KINDS_WORDS = {
  about:
    "A kind is the type of a concept, chosen by the person who wrote it. Counts include only the concepts you can read.",
  loading: "The kinds are still loading.",
  none: "No kinds to show yet. A kind appears here once it holds a concept you can read.",
  noneSmall: "No kinds have two or fewer concepts.",
  caption: "Kinds in the knowledge base and how many concepts each has.",
  count: (shown: number, total: number): string =>
    shown === total ? kindsCounted(total) : `${shown} of ${kindsCounted(total)}`,
  columns: { kind: "Kind", concepts: "Concepts" },
  tail: "Kinds With Two or Fewer Concepts",
  byCollection: "by collection",
  collectionsOf: (kind: string): string => `Concepts of ${kind} by collection`,
  noCollection: CONCEPT_WORDS.noCollection,
  selectFirst: "Please select a kind first.",
  refusals: {
    "owner-forbids": "You no longer own any collections, so you can’t view this page.",
    "role-forbids": "You don’t have permission to view this page.",
  } satisfies OwnSentences,
} as const;

type Family = RecordsExported["families"][number];

const FAMILY_WORDS = {
  owners: "owners",
  verifications: "verifications",
  usage: "usage",
} as const satisfies Readonly<Record<Family, string>>;

const listed = (items: readonly string[]): string => {
  const last = items.at(-1);
  if (items.length < 2 || last === undefined) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${last}`;
};

export const EXPORTS_WORDS = {
  about:
    "Download a copy of your company’s knowledge. The copy won’t update when your knowledge changes.",
  count: (count: number): string => counted(count, "export", "exports"),
  download: "Download",
  preparing: "Preparing",
  ofThe: (name: string): string => ` the ${name}`,
  preparingSaid: (name: string): string => `Preparing the ${name}. This can take a moment.`,
  knowledgeBase: {
    name: "Knowledge Base Snapshot",
    holds: "A zip file of every concept you can read right now. Guides are not included.",
    saved: (file: string, files: number): string =>
      `Downloaded ${file}, with ${counted(files, "file", "files")} from your knowledge base.`,
  },
  records: {
    name: "Records",
    holds: "A zip file with three spreadsheets: owners, verifications and usage of your knowledge.",
    saved: (file: string, families: readonly Family[]): string =>
      `Downloaded ${file}, with ${counted(families.length, "spreadsheet", "spreadsheets")}: ${listed(families.map((family) => FAMILY_WORDS[family]))}.`,
  },
  guide: {
    name: "Guide Snapshot",
    holds:
      "A document with a guide’s Briefs, dated and marked as not maintained. It won’t update when the guide changes. Each Brief in it is recorded as used.",
    picker: "Guide",
    option: (guide: GuideSummary): string => `${guideTitleOf(guide)} (${guide.kind})`,
    loading: "The guides are still loading.",
    none: "No guides to show yet. A guide appears here once one is set up for a collection you can read.",
    retry: "Retry",
    saved: (file: string, briefs: number): string =>
      `Downloaded ${file}, with ${counted(briefs, "Brief", "Briefs")}. Each Brief is recorded as used.`,
  },
} as const;

export const SAID_OF_EXPORTED_KNOWLEDGE_BASE = {
  "role-forbids": "You don’t have permission to download the knowledge base.",
  "not-found": "Your knowledge base has no saved version yet, so there is nothing to download.",
  "unrecorded-head":
    "A change to your knowledge base is still being saved. Nothing was downloaded. Please try again in a minute.",
  "export-too-large":
    "Your knowledge base is too large to download as one file. Nothing was downloaded.",
} satisfies OwnSentences;

export const SAID_OF_EXPORTED_RECORDS = {
  "role-forbids": "You don’t have permission to download the records.",
  "export-too-large": "Your records are too large to download as one file. Nothing was downloaded.",
} satisfies OwnSentences;

export const SAID_OF_EXPORTED_GUIDE = {
  "role-forbids": "You don’t have permission to download a guide.",
  "not-found": "This guide is no longer available. Please choose another guide.",
} satisfies OwnSentences;
