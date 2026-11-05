import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { GuideSection } from "../knowledge-api.ts";

type NeedsReview = NonNullable<GuideSection["needsReview"]>;

const factsCounted = (met: number, of: number): string =>
  `${String(met)} of ${String(of)} expected ${of === 1 ? "fact" : "facts"} recorded`;

export const GUIDES_WORDS = {
  about:
    "A guide gives your people what the company knows about one subject, section by section, filled from its concepts.",
  loading: "The guides are still loading.",
  none: "No guides to show yet. A guide appears here once one is set up for a collection you can read.",
  count: (count: number): string => counted(count, "Guide", "Guides"),
  sections: (count: number): string => counted(count, "section", "sections"),
  needReview: (count: number): string =>
    `${counted(count, "section", "sections")} ${count === 1 ? "needs" : "need"} review`,
} as const;

export const GUIDE_WORDS = {
  loading: "The guide is still loading.",
  toGuides: "Back to Guides",
  subject: "Subject",
  total: factsCounted,
  noFacts: "No facts are expected here.",
  heading: (number: string, prompt: string): string => `${number}. ${prompt}`,
  needsReview: "Needs review",
  reasons: {
    "concept-changed": "Cites a concept that changed",
    "concept-removed": "Cites a concept that was removed",
    "expectation-unmet": "Expects a fact that is not yet recorded",
    "review-finding": "A review found something to check",
  } satisfies Record<NeedsReview, string>,
  withheld: "You can’t read the text of this section.",
  noBrief: "This section has no text yet.",
  footnotes: "Footnotes",
  showDetail: "Show Detail",
  detailOf: (number: string): string => `Detail of section ${number}`,
  noDetail: "No concepts are included in this section yet.",
  missing: (name: string, owner: string | undefined): string =>
    `${name} not yet recorded. ${owner === undefined ? "No owner is named yet, so an Admin decides." : `Owner ${owner}.`}`,
  available: (name: string): string => `${name} is recorded but not in this section.`,
  addFact: "Add This Fact",
  include: "Include",
  included: (number: string): string => `Included in section ${number}.`,
  selectFirst: "Please select a section first.",
  nothingToAdd: "No fact is missing from this section, so there is nothing to add.",
} as const;

export const BRIEF_WORDS = {
  edit: "Edit Brief",
  save: "Save Brief",
  close: "Close editor",
  loading: "The editor is still loading.",
  label: (number: string): string => `Brief of section ${number}`,
  editing: (number: string): string => `Editing the Brief of section ${number}`,
  formatting: "Formatting",
  placing: "Place a footnote",
  footnote: "Footnote: ",
  notPlaced: "not placed",
  noIncludes: "No concepts are included in this section to place as footnotes.",
  saving: "Saving the Brief.",
  saved: (version: number): string => `Saved version ${String(version)}.`,
  unchanged: (version: number): string => `No changes to save. Version ${String(version)} stands.`,
  stale: "Someone saved this Brief after you opened it.",
  reload: "Reload the Brief",
  reloaded: "Loaded the latest Brief. Your unsaved text is kept below it.",
  earlier: "Your unsaved text from before the reload",
  earlierDetail:
    "This text is not saved. It is selected when you move into it, so you can copy it and put what you need into the Brief above.",
  discardEarlier: "Discard this text",
  leaving: "You have changes to a Brief that are not saved.",
  leavingDetail: "Your changes stay in this tab, and Edit Brief opens them again if you come back.",
  leave: "Leave",
  keepEditing: "Keep editing",
} as const;

export const SAID_OF_GUIDES = {
  "not-found": "This guide isn’t available. Please go back to Guides.",
  "marker-without-include":
    "A footnote in the Brief points at a concept this section no longer includes. Please remove it, then save again.",
  "stale-precondition": BRIEF_WORDS.stale,
  "role-forbids": "Only an Editor or an Admin can change a guide.",
} satisfies OwnSentences;
