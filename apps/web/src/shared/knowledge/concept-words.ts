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
  sourceNamed: (place: number, label: string): string => `Source ${place}: ${label}`,
  neverVerified: "No verification recorded",
  verifiedOn: (day: string, byAPerson: boolean): string =>
    byAPerson ? `${day} · by a person` : `${day} · automatically`,
  place: (at: string): string => `· ${at}`,
  noLinks: "No links you can read",
  ownPage: "Open This Concept’s Page",
  noCollection: "No collection",
  notCompanyKnowledge: "Not company knowledge",
} as const;
