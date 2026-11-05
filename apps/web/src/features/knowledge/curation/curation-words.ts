import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

const conceptsCounted = (count: number): string => counted(count, "concept", "concepts");

export const ALL_KNOWLEDGE_WORDS = {
  about:
    "Every concept you can read, with its owner and who last checked it. An Admin can set the owner of many at once.",
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

export const EXPORTS_WORDS = {} as const;
