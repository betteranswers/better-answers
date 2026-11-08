import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import { guideTitleOf } from "@/shared/knowledge/guide-title.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { GuideSummary, RecordsExported } from "../knowledge-api.ts";

const conceptsCounted = (count: number): string => counted(count, "concept", "concepts");

export const ALL_KNOWLEDGE_WORDS = {
  caption: "Concepts",
  loading: "The knowledge base is still loading.",
  none: "No concepts yet.",
  noneMatch: "No concepts match these filters.",
  count: conceptsCounted,
  matching: (count: number): string =>
    `${String(count)} matching ${count === 1 ? "concept" : "concepts"}`,
  columns: {
    title: "Title",
    kind: "Type",
    collection: "Collection",
    trust: "Trust",
    owner: "Owner",
    checked: "Last verified",
  },
  noCollection: CONCEPT_WORDS.noCollection,
  unowned: "No owner",
  unnamed: "Unnamed member",
  ownOwner: "Set on this concept",
  notChecked: "Not yet",
  checkedBy: (by: string): string => `by ${by}`,
  automatically: "automatically",
  filters: {
    collection: { label: "Collection", any: "Any collection", yours: "Collections you own" },
    kind: { label: "Type", any: "Any type" },
  },
  selected: "Selected concepts",
  everyOnThePage: "Select every concept on this page",
  selectFirst: "Select a concept first.",
  pages: "Pages of concepts",
  setOwner: {
    action: "Set owner",
    consequence: (count: number): string => `Choose a new owner for ${conceptsCounted(count)}.`,
    newOwner: "New owner",
    choose: "Choose a person",
    collectionsOwner: "Use the collection’s owner",
    pending: (name: string, count: number): string =>
      `Setting ${name} as the owner of ${conceptsCounted(count)}.`,
    done: (name: string, count: number): string => `${name} now owns ${conceptsCounted(count)}.`,
    returning: (count: number): string => `Updating the owner of ${conceptsCounted(count)}.`,
    returned: (count: number): string => `Removed the owner set on ${conceptsCounted(count)}.`,
    stillGoing: "Still setting the owner.",
    tooMany: (most: number): string => `Select ${most} concepts or fewer.`,
  },
  refusedOnRead: {
    "owner-forbids":
      "You need to own a collection to view this page. An Admin can make you an owner.",
    "role-forbids": "You don’t have permission to view this page.",
  } satisfies OwnSentences,
  refusedOnSetOwner: {
    "owner-forbids":
      "You need to own a collection to view this page. An Admin can make you an owner.",
    "role-forbids": "You don’t have permission to set the owner of concepts.",
    "no-such-member": "That person is no longer a member. Choose someone else.",
    "no-such-concept": "A selected concept is no longer available. No owners were changed.",
    malformed: "Select between 1 and 200 concepts and choose a person.",
  } satisfies OwnSentences,
} as const;

const typesCounted = (count: number): string => counted(count, "type", "types");

export const KINDS_WORDS = {
  loading: "The concept types are still loading.",
  none: "No concept types yet.",
  noneSmall: "No types have 2 or fewer concepts.",
  caption: "Concept types",
  count: (shown: number, total: number): string =>
    shown === total ? typesCounted(total) : `${shown} of ${typesCounted(total)}`,
  columns: { kind: "Type", concepts: "Concepts" },
  tail: "Types with 2 or fewer concepts",
  byCollection: "by collection",
  collectionsOf: (kind: string): string => `${kind} concepts by collection`,
  noCollection: CONCEPT_WORDS.noCollection,
  selectFirst: "Select a type first.",
  refusals: {
    "owner-forbids":
      "You need to own a collection to view this page. An Admin can make you an owner.",
    "role-forbids": "You don’t have permission to view this page.",
  } satisfies OwnSentences,
} as const;

type Family = RecordsExported["families"][number];

export const EXPORTS_WORDS = {
  download: "Download",
  preparing: "Preparing",
  ofThe: (name: string): string => ` the ${name.toLowerCase()}`,
  preparingSaid: (name: string): string => `Preparing the ${name.toLowerCase()}.`,
  knowledgeBase: {
    name: "Knowledge base snapshot",
    holds: "A zip file of every concept you can read.",
    saved: (file: string, files: number): string =>
      `Downloaded ${file} (${counted(files, "file", "files")}).`,
  },
  records: {
    name: "Records",
    holds: "A zip file with three spreadsheets: owners, verifications and usage.",
    saved: (file: string, families: readonly Family[]): string =>
      `Downloaded ${file} (${counted(families.length, "spreadsheet", "spreadsheets")}).`,
  },
  guide: {
    name: "Guide snapshot",
    holds: "A file of a guide’s Briefs.",
    picker: "Guide",
    option: (guide: GuideSummary): string => `${guideTitleOf(guide)} (${guide.kind})`,
    loading: "The guides are still loading.",
    none: "No guides yet.",
    retry: "Retry",
    saved: (file: string, briefs: number): string =>
      `Downloaded ${file} (${counted(briefs, "Brief", "Briefs")}).`,
  },
} as const;

export const SAID_OF_EXPORTED_KNOWLEDGE_BASE = {
  "role-forbids": "You don’t have permission to download the knowledge base.",
  "not-found": "No concepts to download.",
  "unrecorded-head": "A change is still saving. Try again in a moment.",
  "export-too-large": "The knowledge base is too large to download as one file.",
} satisfies OwnSentences;

export const SAID_OF_EXPORTED_RECORDS = {
  "role-forbids": "You don’t have permission to download the records.",
  "export-too-large": "The records are too large to download as one file.",
} satisfies OwnSentences;

export const SAID_OF_EXPORTED_GUIDE = {
  "role-forbids": "You don’t have permission to download a guide.",
  "not-found": "This guide is no longer available. Choose another guide.",
} satisfies OwnSentences;
