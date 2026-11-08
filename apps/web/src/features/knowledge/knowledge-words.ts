import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

const quoted = (query: string): string => `“${query}”`;

export const COLLECTIONS_WORDS = {
  loading: "Loading collections…",
  none: "No collections yet.",
  count: (count: number): string => counted(count, "collection", "collections"),
  owner: "Owner",
  unowned: "No owner",
  unnamed: "Unnamed member",
  ownOwners: "Concepts with an owner set on them",
  noOwnOwners: "None",
  ownOwnersCount: (count: number): string => counted(count, "concept", "concepts"),
  ofCollection: (collection: string): string => ` of ${collection}`,
  noOwner: "No owner",
  save: "Save",
  saveOf: (collection: string): string => ` the owner of ${collection}`,
  named: (name: string, collection: string): string => `${name} now owns ${quoted(collection)}.`,
  cleared: (collection: string): string => `${quoted(collection)} has no owner now.`,
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

const collectionNamed = (collection: string | null): string =>
  collection ?? CONCEPT_WORDS.noCollection;

export const KNOWLEDGE_BASE_WORDS = {
  tree: "Collections and types",
  collection: collectionNamed,
  labelled: (name: string, count: number): string => `${name}, ${conceptsCounted(count)}`,
  count: conceptsCounted,
  loading: "Loading the knowledge base…",
  none: "No concepts yet.",
  concepts: "Concepts",
  openAKind: "Open a collection, then choose a type.",
  kindIn: (kind: string, collection: string | null): string =>
    collection === null ? `${kind}, ${CONCEPT_WORDS.noCollection}` : `${kind} in ${collection}`,
  conceptsLoading: "Loading concepts…",
  noneOfTheKind: "No concepts of this type yet.",
  columns: { title: "Title", trust: "Trust" },
  more: "Show more concepts",
} as const;

export const RELATION_WORDS: ReadonlyMap<string, string> = new Map([
  ["SUPERSEDES", "Supersedes"],
  ["CITES", "Cites"],
]);
