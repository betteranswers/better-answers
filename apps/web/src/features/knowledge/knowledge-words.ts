import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

const quoted = (query: string): string => `“${query}”`;

export const COLLECTIONS_WORDS = {
  about:
    "A collection is one part of the company’s knowledge, such as a product, a service or a sector. Its owner keeps the concepts in it checked and up to date, unless a concept names an owner of its own.",
  loading: "The collections are still loading.",
  none: "No collections yet. A collection appears here once a concept is saved in one.",
  count: (count: number): string => counted(count, "collection", "collections"),
  owner: "Owner",
  unowned: "No owner yet. Until an Admin names one, only Admins can edit its concepts.",
  unnamed: "A member with no display name yet",
  ownOwners: "Concepts with Their Own Owner",
  noOwnOwners: "None",
  ownOwnersCount: (count: number): string => counted(count, "concept", "concepts"),
  newOwner: "New Owner",
  ofCollection: (collection: string): string => ` of ${collection}`,
  noOwner: "No Owner",
  save: "Save",
  saveOf: (collection: string): string => ` the new owner of ${collection}`,
  named: (name: string, collection: string): string => `${name} now owns ${quoted(collection)}.`,
  cleared: (collection: string): string =>
    `${quoted(collection)} has no owner now, so only Admins can edit its concepts.`,
  alreadyOwns: (name: string, collection: string): string =>
    `${name} already owns ${quoted(collection)}.`,
  alreadyUnowned: (collection: string): string => `${quoted(collection)} already has no owner.`,
} as const;

export const SAID_OF_COLLECTIONS = {
  "owner-forbids": "You no longer own a collection, so this page is no longer open to you.",
  "no-such-member":
    "That person is no longer a member of this workspace. Please choose someone else.",
} satisfies OwnSentences;

export const SEARCH_WORDS = {
  search: "Search by a word or a question",
  nothingAsked: "Type to search.",
  searching: (query: string): string => `Searching for ${quoted(query)}.`,
  noMatches: (query: string): string =>
    `No results found for ${quoted(query)}. Try a different word or question.`,
  matched: (query: string, more: boolean): string =>
    more
      ? `Showing the first matches for ${quoted(query)}.`
      : `Showing matches for ${quoted(query)}.`,
  matches: "Matches",
  passageLeft: "The passage you had open is no longer listed.",
  selectFirst: "Please select a match first.",
  more: "More Matches",
  document: "Document",
} as const;

export const RELATION_WORDS: ReadonlyMap<string, string> = new Map([
  ["LINKS_TO", "Links to"],
  ["SUPERSEDES", "Supersedes"],
  ["CITES", "Cites"],
]);
