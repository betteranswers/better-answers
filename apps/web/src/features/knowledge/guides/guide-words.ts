import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { GuideSection } from "../knowledge-api.ts";

type NeedsReview = NonNullable<GuideSection["needsReview"]>;

const factsCounted = (met: number, of: number): string =>
  `${String(met)} of ${String(of)} expected ${of === 1 ? "fact" : "facts"} recorded`;

export const GUIDES_WORDS = {
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
  noFacts: "No facts are expected in this section.",
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
    `${name} isn’t recorded yet. ${owner === undefined ? "It has no owner, so an Admin is responsible for it." : `Owner: ${owner}.`}`,
  available: (name: string): string => `${name} is recorded but not included in this section.`,
  addFact: "Add This Fact",
  include: "Include",
  included: (number: string): string => `Included in section ${number}.`,
  selectFirst: "Please select a section first.",
  nothingToAdd: "No fact is missing from this section, so there is nothing to add.",
  copy: "Copy",
  copying: (number: string): string => `Copying section ${number}.`,
  copied: (number: string, footnotes: number): string =>
    footnotes === 0
      ? `Copied section ${number}. It has no footnotes.`
      : `Copied section ${number} with ${counted(footnotes, "footnote", "footnotes")}. Footnote numbers start at 1 in each copy.`,
  notRecorded: "This copy couldn’t be recorded.",
  notAllowed: "Your browser did not allow copying. Nothing was copied.",
  belowYourRole:
    "You can’t copy this section yet. Some of its concepts aren’t verified enough for your role.",
  nothingToCopy: "Copy isn’t available for this section.",
  closeToCopy: "Close the editor before you copy this section. Copy uses the saved Brief.",
} as const;

export const BRIEF_WORDS = {
  edit: "Edit Brief",
  save: "Save Brief",
  close: "Close Editor",
  loading: "The editor is still loading.",
  label: (number: string): string => `Brief of section ${number}`,
  editing: (number: string): string => `Editing the Brief of section ${number}`,
  formatting: "Formatting",
  placing: "Place a Footnote",
  footnote: "Footnote: ",
  notPlaced: "not placed",
  noIncludes: "No concepts are included in this section to place as footnotes.",
  saving: "Saving the Brief.",
  saved: (version: number): string => `Saved version ${String(version)}.`,
  unchanged: (version: number): string =>
    `There are no changes to save. Version ${String(version)} is still the latest.`,
  stale: "Someone saved this Brief after you opened it.",
  reload: "Reload the Brief",
  reloaded: "Loaded the latest Brief. Your unsaved text is kept below it.",
  earlier: "Your unsaved text from before the reload",
  earlierDetail: "This text isn’t saved. Copy what you need from it into the Brief above.",
  discardEarlier: "Discard This Text",
  leaving: "You have unsaved changes to this Brief.",
  leavingDetail: "Your changes are kept in this tab. Select Edit Brief to go back to them.",
  leave: "Leave",
  keepEditing: "Keep Editing",
} as const;

export const SAID_OF_GUIDES = {
  "not-found": "This guide isn’t available. Please go back to Guides.",
  "marker-without-include":
    "A footnote in the Brief refers to a concept that is no longer in this section. Please remove the footnote, then save again.",
  "stale-precondition": BRIEF_WORDS.stale,
  "role-forbids": "You don’t have permission to change this guide.",
  "below-action-threshold": GUIDE_WORDS.belowYourRole,
} satisfies OwnSentences;
