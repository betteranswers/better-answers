import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import { guideTitleOf } from "@/shared/knowledge/guide-title.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { GuideSummary, RecordsExported } from "../knowledge-api.ts";

const conceptsCounted = (count: number): string => counted(count, "concept", "concepts");

export const ALL_KNOWLEDGE_WORDS = {
  about:
    "The table lists every concept you can read, with its owner and who last checked it. An Admin can set the owner of many at once.",
  caption: "Every concept you can read, with its kind, collection, owner and last check.",
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
    checked: "Last Checked",
  },
  noCollection: CONCEPT_WORDS.noCollection,
  unowned: "No owner yet",
  unnamed: "A member with no display name yet",
  ownOwner: "Named for this concept",
  notChecked: "Not checked yet",
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
      "The person you choose becomes the owner of each selected concept, in place of its collection’s owner. Each change goes in the audit log.",
    newOwner: "New Owner",
    choose: "Choose a person",
    pending: (name: string, count: number): string =>
      `Setting ${name} as the owner of ${conceptsCounted(count)}.`,
    done: (name: string, count: number): string => `${name} now owns ${conceptsCounted(count)}.`,
    stillGoing: "The owner is still being set. Please wait.",
    tooMany: (most: number): string => `Please select ${most} concepts or fewer.`,
  },
  refusedOnRead: {
    "owner-forbids": "You no longer own a collection, so this page is no longer open to you.",
    "role-forbids": "Only an Admin or the owner of a collection can see all knowledge.",
  } satisfies OwnSentences,
  refusedOnSetOwner: {
    "owner-forbids": "You no longer own a collection, so this page is no longer open to you.",
    "role-forbids": "Only an Admin can set the owner of concepts.",
    "no-such-member":
      "That person is no longer a member of this workspace. Please choose someone else.",
    "no-such-concept":
      "A selected concept is no longer there, or you can no longer read it. No owner was set. Please reload the page and choose again.",
    malformed: "Please select between 1 and 200 concepts and choose a person.",
  } satisfies OwnSentences,
} as const;

const kindsCounted = (count: number): string => counted(count, "kind", "kinds");

export const KINDS_WORDS = {
  about:
    "A kind is the type of a concept, in the word its writer chose. Each count covers only the concepts you can read.",
  loading: "The kinds are still loading.",
  none: "No kinds to show yet. A kind appears here once it holds a concept you can read.",
  noneSmall: "Every kind holds more than two concepts.",
  caption: "Kinds of concept in the knowledge base, with how many concepts hold each.",
  count: (shown: number, total: number): string =>
    shown === total ? kindsCounted(total) : `${shown} of ${kindsCounted(total)}`,
  columns: { kind: "Kind", concepts: "Concepts" },
  tail: "Kinds With Two or Fewer Concepts",
  byCollection: "by collection",
  collectionsOf: (kind: string): string => `Concepts of ${kind} by collection`,
  noCollection: CONCEPT_WORDS.noCollection,
  selectFirst: "Please select a kind first.",
  refusals: {
    "owner-forbids": "You no longer own a collection, so this page is no longer open to you.",
    "role-forbids": "Only Admins and the owners of a collection can see the kinds.",
  } satisfies OwnSentences,
} as const;

type Family = RecordsExported["families"][number];

const FAMILY_WORDS = {
  owners: "the owners",
  verifications: "the checks",
  usage: "the uses",
} as const satisfies Readonly<Record<Family, string>>;

const listed = (items: readonly string[]): string => {
  const last = items.at(-1);
  if (items.length < 2 || last === undefined) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${last}`;
};

export const EXPORTS_WORDS = {
  about:
    "Download a copy of what your company knows. A copy does not change when your knowledge does.",
  count: (count: number): string => counted(count, "export", "exports"),
  download: "Download",
  preparing: "Preparing",
  ofThe: (name: string): string => ` the ${name}`,
  preparingSaid: (name: string): string => `Preparing the ${name}. This can take a moment.`,
  knowledgeBase: {
    name: "Knowledge Base Snapshot",
    holds:
      "One zip file holds every concept file you can read at this moment. The guides are not in it.",
    saved: (file: string, files: number): string =>
      `Saved ${file}. It holds ${counted(files, "file", "files")} from your knowledge base.`,
  },
  records: {
    name: "Records",
    holds:
      "Three spreadsheets in one zip file list the owners, the checks and the uses of your knowledge.",
    saved: (file: string, families: readonly Family[]): string =>
      `Saved ${file}. It holds ${listed(families.map((family) => FAMILY_WORDS[family]))} as ${counted(families.length, "spreadsheet", "spreadsheets")}.`,
  },
  guide: {
    name: "Guide Snapshot",
    holds:
      "One document holds a guide’s Briefs. It is dated and marked not maintained, so it does not change when the guide does. Downloading it counts as a use of each Brief it holds.",
    picker: "Guide",
    option: (guide: GuideSummary): string => `${guideTitleOf(guide)} (${guide.kind})`,
    loading: "The guides are still loading.",
    none: "No guides to show yet. A guide appears here once one is set up for a collection you can read.",
    retry: "Retry",
    saved: (file: string, briefs: number): string =>
      `Saved ${file}. It holds ${counted(briefs, "Brief", "Briefs")}, marked not maintained. Each one now counts as used.`,
  },
} as const;

export const SAID_OF_EXPORTED_KNOWLEDGE_BASE = {
  "role-forbids": "Only an Admin can download the knowledge base.",
  "not-found": "Your knowledge base has no saved version yet, so there is nothing to download.",
  "unrecorded-head":
    "A change to your knowledge base is still being saved. Nothing was downloaded. Please try again in a minute.",
  "export-too-large":
    "Your knowledge base is too large to take in one file. Nothing was downloaded.",
} satisfies OwnSentences;

export const SAID_OF_EXPORTED_RECORDS = {
  "role-forbids": "Only an Admin can download the records.",
  "export-too-large": "Your records are too large to take in one file. Nothing was downloaded.",
} satisfies OwnSentences;

export const SAID_OF_EXPORTED_GUIDE = {
  "role-forbids": "Only an Admin can download a guide.",
  "not-found": "This guide is no longer available. Please choose another guide.",
} satisfies OwnSentences;
