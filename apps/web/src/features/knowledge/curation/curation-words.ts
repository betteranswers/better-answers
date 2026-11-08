import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import { guideTitleOf } from "@/shared/knowledge/guide-title.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { GuideSummary, RecordsExported } from "../knowledge-api.ts";

const conceptsCounted = (count: number): string => counted(count, "concept", "concepts");

export const ALL_KNOWLEDGE_WORDS = {
  caption: "Every concept you can read.",
  loading: "The knowledge base is still loading.",
  none: "No concepts yet.",
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
    checked: "Last verified",
  },
  noCollection: CONCEPT_WORDS.noCollection,
  unowned: "No owner",
  unnamed: "Unnamed member",
  ownOwner: "Set for this concept only",
  notChecked: "Not verified yet",
  checkedBy: (by: string): string => `by ${by}`,
  filters: {
    collection: { label: "Collection", any: "Any collection", yours: "Collections you own" },
    kind: { label: "Kind", any: "Any kind" },
  },
  selected: "Selected concepts",
  everyOnThePage: "Select every concept on this page",
  selectFirst: "Select a concept first.",
  pages: "Pages of concepts",
  setOwner: {
    action: "Set owner",
    title: (count: number): string => `Set the owner of ${counted(count, "concept", "concepts")}`,
    consequence:
      "The person you choose will own each selected concept. To undo, choose “Its collection’s owner”.",
    newOwner: "New owner",
    choose: "Choose a person",
    collectionsOwner: "Its collection’s owner",
    pending: (name: string, count: number): string =>
      `Setting ${name} as the owner of ${conceptsCounted(count)}.`,
    done: (name: string, count: number): string => `${name} now owns ${conceptsCounted(count)}.`,
    returning: (count: number): string =>
      `Removing the ${count === 1 ? "owner" : "owners"} set for ${conceptsCounted(count)}.`,
    returned: (count: number): string =>
      `${conceptsCounted(count)} no longer ${count === 1 ? "has its" : "have their"} own owner.`,
    stillGoing: "Still setting the owner.",
    tooMany: (most: number): string => `Select ${most} concepts or fewer.`,
  },
  refusedOnRead: {
    "owner-forbids": "You can’t view this page. You no longer own a collection.",
    "role-forbids": "You don’t have permission to view this page.",
  } satisfies OwnSentences,
  refusedOnSetOwner: {
    "owner-forbids": "You can’t view this page. You no longer own a collection.",
    "role-forbids": "You don’t have permission to set the owner of concepts.",
    "no-such-member": "That person is no longer a member. Choose someone else.",
    "no-such-concept": "No owners were changed. Reload the page and try again.",
    malformed: "Select between 1 and 200 concepts and choose a person.",
  } satisfies OwnSentences,
} as const;

const kindsCounted = (count: number): string => counted(count, "kind", "kinds");

export const KINDS_WORDS = {
  loading: "The kinds are still loading.",
  none: "No kinds yet.",
  noneSmall: "No kinds have two or fewer concepts.",
  caption: "Each kind and its number of concepts.",
  count: (shown: number, total: number): string =>
    shown === total ? kindsCounted(total) : `${shown} of ${kindsCounted(total)}`,
  columns: { kind: "Kind", concepts: "Concepts" },
  tail: "Kinds with two or fewer concepts",
  byCollection: "by collection",
  collectionsOf: (kind: string): string => `Concepts of ${kind} by collection`,
  noCollection: CONCEPT_WORDS.noCollection,
  selectFirst: "Select a kind first.",
  refusals: {
    "owner-forbids": "You can’t view this page. You no longer own a collection.",
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
  count: (count: number): string => counted(count, "export", "exports"),
  download: "Download",
  preparing: "Preparing",
  ofThe: (name: string): string => ` the ${name.toLowerCase()}`,
  preparingSaid: (name: string): string => `Preparing the ${name.toLowerCase()}.`,
  knowledgeBase: {
    name: "Knowledge base snapshot",
    holds: "A zip file of every concept you can read. It leaves out guides.",
    saved: (file: string, files: number): string =>
      `Downloaded ${file}, with ${counted(files, "file", "files")} from your knowledge base.`,
  },
  records: {
    name: "Records",
    holds: "A zip file with three spreadsheets: owners, verifications and usage.",
    saved: (file: string, families: readonly Family[]): string =>
      `Downloaded ${file}, with ${counted(families.length, "spreadsheet", "spreadsheets")}: ${listed(families.map((family) => FAMILY_WORDS[family]))}.`,
  },
  guide: {
    name: "Guide snapshot",
    holds: "A dated document of a guide’s Briefs. It stays as it is when the guide changes.",
    picker: "Guide",
    option: (guide: GuideSummary): string => `${guideTitleOf(guide)} (${guide.kind})`,
    loading: "The guides are still loading.",
    none: "No guides yet.",
    retry: "Retry",
    saved: (file: string, briefs: number): string =>
      `Downloaded ${file}, with ${counted(briefs, "Brief", "Briefs")}. Each Brief is recorded as used.`,
  },
} as const;

export const SAID_OF_EXPORTED_KNOWLEDGE_BASE = {
  "role-forbids": "You don’t have permission to download the knowledge base.",
  "not-found": "Nothing was downloaded. Your knowledge base has no concepts you can read.",
  "unrecorded-head": "Nothing was downloaded. Try again in a minute.",
  "export-too-large": "Nothing was downloaded. The knowledge base is too large for one file.",
} satisfies OwnSentences;

export const SAID_OF_EXPORTED_RECORDS = {
  "role-forbids": "You don’t have permission to download the records.",
  "export-too-large": "Nothing was downloaded. The records are too large for one file.",
} satisfies OwnSentences;

export const SAID_OF_EXPORTED_GUIDE = {
  "role-forbids": "You don’t have permission to download a guide.",
  "not-found": "This guide is no longer available. Choose another guide.",
} satisfies OwnSentences;
