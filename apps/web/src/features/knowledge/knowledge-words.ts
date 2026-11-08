import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

const quoted = (query: string): string => `“${query}”`;

export const COLLECTIONS_WORDS = {
  loading: "The collections are still loading.",
  none: "No collections yet.",
  count: (count: number): string => counted(count, "collection", "collections"),
  owner: "Owner",
  unowned: "No owner. Only Admins can edit its concepts.",
  unnamed: "Unnamed member",
  ownOwners: "Concepts with their own owner",
  noOwnOwners: "None",
  ownOwnersCount: (count: number): string => counted(count, "concept", "concepts"),
  newOwner: "New owner",
  ofCollection: (collection: string): string => ` of ${collection}`,
  noOwner: "No owner",
  save: "Save",
  saveOf: (collection: string): string => ` the new owner of ${collection}`,
  named: (name: string, collection: string): string => `${name} now owns ${quoted(collection)}.`,
  cleared: (collection: string): string =>
    `${quoted(collection)} no longer has an owner. Only Admins can edit its concepts.`,
  alreadyOwns: (name: string, collection: string): string =>
    `${name} already owns ${quoted(collection)}.`,
  alreadyUnowned: (collection: string): string => `${quoted(collection)} already has no owner.`,
} as const;

export const SAID_OF_COLLECTIONS = {
  "owner-forbids": "You can’t view this page. You no longer own a collection.",
  "no-such-member": "That person is no longer a member. Choose someone else.",
} satisfies OwnSentences;

export const SEARCH_WORDS = {
  search: "Search by a word or a question",
  nothingAsked: "Type a word or a question.",
  searching: (query: string): string => `Searching for ${quoted(query)}.`,
  noMatches: (query: string): string => `Nothing matches ${quoted(query)}.`,
  askThisQuestion: "Ask this question",
  whereNext: "Where to look next",
  matched: (query: string, more: boolean): string =>
    more
      ? `Showing the first matches for ${quoted(query)}.`
      : `Showing matches for ${quoted(query)}.`,
  matches: "Matches",
  passageLeft: "The passage you had open is no longer listed.",
  selectFirst: "Select a match first.",
  more: "More matches",
  document: "Document",
  newConcept: "New concept",
} as const;

export const LAUNCH_WORDS = {
  edit: "Edit",
  suggest: "Suggest an edit",
  loading: "The editor is still loading.",
  suggested: "Suggestion sent to the concept’s owner.",
  suggestedNew: "Suggestion sent to the collection’s owner or an Admin.",
} as const;

const conceptsCounted = (count: number): string => counted(count, "concept", "concepts");

const collectionNamed = (collection: string | null): string =>
  collection ?? CONCEPT_WORDS.noCollection;

export const KNOWLEDGE_BASE_WORDS = {
  tree: "Collections and kinds",
  collection: collectionNamed,
  labelled: (name: string, count: number): string => `${name}, ${conceptsCounted(count)}`,
  count: conceptsCounted,
  loading: "The knowledge base is still loading.",
  none: "No concepts yet.",
  concepts: "Concepts",
  openAKind: "Select a kind to see its concepts.",
  kindIn: (kind: string, collection: string | null): string =>
    collection === null ? `${kind}, ${CONCEPT_WORDS.noCollection}` : `${kind} in ${collection}`,
  conceptsLoading: "The concepts are still loading.",
  noneOfTheKind: "No concepts of this kind yet.",
  columns: { title: "Title", kind: "Kind", trust: "Trust" },
  more: "More concepts",
} as const;

export const RELATION_WORDS: ReadonlyMap<string, string> = new Map([
  ["SUPERSEDES", "Supersedes"],
  ["CITES", "Cites"],
]);
