const quoted = (query: string): string => `“${query}”`;

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
