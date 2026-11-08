import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { GuideSection } from "../knowledge-api.ts";
import { GUIDES_PAGE } from "./guide-state.ts";

type NeedsReview = NonNullable<GuideSection["needsReview"]>;

const factsCounted = (met: number, of: number): string =>
  `${String(met)} of ${String(of)} ${of === 1 ? "fact" : "facts"} included`;

export const GUIDES_WORDS = {
  loading: "The guides are still loading.",
  none: "No guides yet.",
  count: (count: number): string => counted(count, "guide", "guides"),
  sections: (count: number): string => counted(count, "section", "sections"),
  needReview: (count: number): string =>
    `${counted(count, "section", "sections")} ${count === 1 ? "needs" : "need"} review`,
} as const;

export const GUIDE_WORDS = {
  loading: "The guide is still loading.",
  toGuides: CONCEPT_WORDS.backTo(GUIDES_PAGE.name),
  subject: "Subject",
  total: factsCounted,
  heading: (number: string, prompt: string): string => `${number}. ${prompt}`,
  needsReview: "Needs review",
  reasons: {
    "concept-changed": "Cites a concept that changed",
    "concept-removed": "Cites a concept that was removed",
    "expectation-unmet": "A fact isn’t included",
    "review-finding": "A review flagged this section",
  } satisfies Record<NeedsReview, string>,
  withheld: "You can’t read the text of this section.",
  noBrief: "No Brief yet.",
  footnotes: "Footnotes",
  showDetail: "Show detail",
  hideDetail: "Hide detail",
  detailOf: (number: string): string => `Detail of section ${number}`,
  noDetail: "No concepts included yet.",
  missing: (name: string, owner: string | undefined): string =>
    owner === undefined
      ? `${name} isn’t recorded yet.`
      : `${name} isn’t recorded yet. Owner: ${owner}.`,
  available: (name: string): string => `${name} is recorded but not included in this section.`,
  addFact: (name: string): string => `Add ${name}`,
  include: "Include",
  included: (number: string): string => `Included in section ${number}.`,
  selectFirst: "Select a section first.",
  nothingToAdd: "This section has no missing facts.",
  copy: "Copy",
  copying: (number: string): string => `Copying section ${number}.`,
  copied: (number: string, footnotes: number): string =>
    footnotes === 0
      ? `Section ${number} copied.`
      : `Section ${number} copied with ${counted(footnotes, "footnote", "footnotes")}.`,
  notRecorded: "Recording the copy failed.",
  notAllowed: "Your browser blocked copying.",
  belowYourRole: "You can’t copy this section yet. Some of its concepts need verifying first.",
  nothingToCopy: "You can’t copy this section.",
  closeToCopy: "Save or close the editor before you copy.",
} as const;

export const BRIEF_WORDS = {
  edit: "Edit Brief",
  save: "Save Brief",
  close: "Close editor",
  loading: "The editor is still loading.",
  label: (number: string): string => `Brief of section ${number}`,
  editing: (number: string): string => `Editing the Brief of section ${number}`,
  formatting: "Formatting",
  placing: "Add a footnote",
  footnote: "Footnote: ",
  notPlaced: "not cited yet",
  saving: "Saving the Brief.",
  saved: (version: number): string => `Brief saved as version ${String(version)}.`,
  unchanged: (version: number): string =>
    `No changes to save. Version ${String(version)} is the latest.`,
  stale: "Someone else saved this Brief while you were editing.",
  reload: "Reload the Brief",
  reloaded: "Loaded the latest Brief. Your unsaved text is below it.",
  earlier: "Your unsaved text",
  earlierDetail: "Copy what you need into the Brief above.",
  discardEarlier: "Discard this text",
  leaving: "Leave with unsaved changes?",
  leavingDetail: "You can come back to your unsaved text until you close this tab.",
  leave: "Leave",
  keepEditing: "Keep editing",
} as const;

export const SAID_OF_GUIDES = {
  "not-found": "This guide isn’t available.",
  "marker-without-include":
    "A footnote cites a concept this section no longer includes. Remove the footnote, then save again.",
  "stale-precondition": BRIEF_WORDS.stale,
  "role-forbids": "You don’t have permission to change this guide.",
  "below-action-threshold": GUIDE_WORDS.belowYourRole,
} satisfies OwnSentences;
