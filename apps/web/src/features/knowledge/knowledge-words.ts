const quoted = (query: string): string => `“${query}”`;

export const SEARCH_WORDS = {
  search: "Search by a word or a question",
  nothingAsked: "Type a word or a question to search what this workspace knows.",
  searching: (query: string): string => `Searching for ${quoted(query)}.`,
  noMatches: (query: string): string => `Nothing this workspace knows matches ${quoted(query)}.`,
  matched: (query: string, more: boolean): string =>
    more ? `Matches for ${quoted(query)}. More follow.` : `Matches for ${quoted(query)}.`,
  matches: "Matches",
  more: "More matches",
  document: "Document",
  notCompanyKnowledge: "Not company knowledge",
} as const;

export const EVIDENCE_WORDS = {
  loading: "The passage is still loading.",
  close: "Close",
} as const;
