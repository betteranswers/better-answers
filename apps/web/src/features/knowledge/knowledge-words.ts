import { collectionNameOf } from "@better-answers/schema/collection-name";

import { collectionLabelOf } from "@/shared/knowledge/collection-name.ts";
import { EMPTY_WORDS } from "@/shared/knowledge/concept-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

const quoted = (query: string): string => `“${query}”`;

export const COLLECTIONS_WORDS = {
  loading: "Loading collections…",
  none: "No collections yet.",
  caption: "Collections",
  count: (count: number): string => counted(count, "collection", "collections"),
  columns: { collection: "Collection", owner: "Owner", concepts: "Concepts", verified: "Verified" },
  ownOwners: (count: number): string => `Concepts with their own owner: ${String(count)}`,
  ownerOf: (collection: string, owner: string): string => `Owner of ${collection}, ${owner}`,
  people: "People",
  searchPeople: "Search people",
  nobody: "No one found.",
  verifiedShare: (percent: number): string => `${String(percent)}%`,
  named: (name: string, collection: string): string => `${name} now owns ${quoted(collection)}.`,
  cleared: (collection: string): string => `${quoted(collection)} has no owner now.`,
  undo: "Undo",
  undoOf: (collection: string): string => `Undo the owner change for ${collection}`,
} as const;

export const SAID_OF_COLLECTIONS = {
  "owner-forbids":
    "You need to own a collection to view this page. An Admin can make you an owner.",
  "no-such-member": "That person is no longer a member. Choose someone else.",
} satisfies OwnSentences;

export const SEARCH_WORDS = {
  search: "Search by a word or a question",
  searching: (query: string): string => `Searching for ${quoted(query)}…`,
  noMatches: (query: string): string => `No matches for ${quoted(query)}.`,
  askThisQuestion: "Ask this question",
  whereNext: "Where to look next",
  matched: (query: string, count: number, more: boolean): string =>
    `${more ? `More than ${String(count)} matches` : counted(count, "match", "matches")} for ${quoted(query)}.`,
  matches: "Matches",
  passageLeft: "The passage you opened is no longer in the results.",
  selectFirst: "Select a match first.",
  more: "Show more matches",
  document: "Document",
  newConcept: "New concept",
} as const;

export const LAUNCH_WORDS = {
  edit: "Edit",
  suggest: "Suggest an edit",
  loading: "Loading the editor…",
  suggested: "Suggestion sent to the concept’s owner or an Admin.",
  suggestedNew: "Suggestion sent to the collection’s owner or an Admin.",
} as const;

const conceptsCounted = (count: number): string => counted(count, "concept", "concepts");

export const KNOWLEDGE_BASE_WORDS = {
  tree: "Collections and types",
  collection: collectionLabelOf,
  labelled: (name: string, count: number): string => `${name}, ${conceptsCounted(count)}`,
  count: conceptsCounted,
  loading: "Loading the knowledge base…",
  none: "No concepts yet.",
  concepts: "Concepts",
  openACollection: "Open a collection to see its types.",
  chooseAType: "Choose a type to see its concepts.",
  conceptTypeIn: (conceptType: string, collection: string | null): string =>
    collection === null
      ? `${conceptType}, ${EMPTY_WORDS.collection}`
      : `${conceptType} in ${collectionNameOf(collection)}`,
  conceptsLoading: "Loading concepts…",
  noneOfTheType: "No concepts of this type yet.",
  columns: { title: "Title", trust: "Trust" },
  more: "Show more concepts",
} as const;

export const RELATION_WORDS: ReadonlyMap<string, string> = new Map([
  ["SUPERSEDES", "Supersedes"],
  ["CITES", "Cites"],
]);
