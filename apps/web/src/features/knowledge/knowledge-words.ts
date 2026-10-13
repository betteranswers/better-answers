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
  /** True of a match re-ranked past the pages shown as of one withheld, so it says neither. */
  passageLeft: "The passage you had open is no longer listed.",
  more: "More Matches",
  document: "Document",
  noCollection: "No collection",
  notCompanyKnowledge: "Not company knowledge",
} as const;

export const EVIDENCE_WORDS = {
  loading: "The passage is still loading.",
  close: "Close",
} as const;

export const CONCEPT_WORDS = {
  loading: "The concept is still loading.",
  untitled: "Untitled Concept",
  toSearch: "Back to Search",
  sources: "Sources",
  verification: "Verification",
  links: "Links",
  details: "Details from the File",
  footnotes: "Footnotes",
  backToTheClaim: "Back to the Claim",
  tags: "Tags",
  /** A citation mark and its entry in the sources list are named alike, by the file’s own label. */
  sourceNamed: (place: number, label: string): string => `Source ${place}: ${label}`,
  neverVerified: "No verification recorded",
  verifiedOn: (day: string, byAPerson: boolean): string =>
    byAPerson ? `${day} · by a person` : `${day} · automatically`,
  place: (at: string): string => `· ${at}`,
  noLinks: "No links you can read",
  ownPage: "Open This Concept’s Page",
} as const;

/** A relation's kind as the map names it, in a reader's words; any other kind is shown untagged. */
export const RELATION_WORDS: ReadonlyMap<string, string> = new Map([
  ["LINKS_TO", "Links to"],
  ["SUPERSEDES", "Supersedes"],
  ["CITES", "Cites"],
]);
