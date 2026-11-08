import type { OwnSentences } from "@/shared/refusal-words.ts";

import { LAUNCH_WORDS } from "../knowledge-words.ts";

export const EDITOR_WORDS = {
  ...LAUNCH_WORDS,
  headingEdit: "Edit concept",
  headingSuggest: "Suggest an edit",
  headingNew: "New concept",
  title: "Title",
  kind: "Type",
  description: "Description",
  tags: "Tags",
  tagsHint: "Separate tags with commas.",
  collection: "Collection",
  chooseCollection: "Choose a collection",
  body: "Body",
  sources: "Sources",
  source: (number: number): string => `Source ${String(number)}`,
  remove: "Remove",
  removeSource: (number: number): string => `Remove source ${String(number)}`,
  addSource: "Add a source",
  withheld: (count: number): string =>
    count === 1
      ? "1 source you can’t open is kept."
      : `${String(count)} sources you can’t open are kept.`,
  editAs: "Edit as",
  visual: "Visual",
  markdown: "Markdown",
  lossy: "Edit this text in Markdown. The visual editor can’t show all of it.",
  warning: "Warning",
  suggests: "Your edit goes to the concept’s owner or an Admin for review.",
  suggestsNew: "Your concept goes to the collection’s owner or an Admin for review.",
  reuse: (places: number): string =>
    `This concept is used in ${String(places)} places. Save your change to all of them?`,
  save: "Save",
  sendSuggestion: "Send suggestion",
  keepEditing: "Keep editing",
  close: "Close",
  leave: "Discard changes",
  leaving: "Discard your unsaved changes?",
  cannotSave: {
    collection: "Choose a collection before you save.",
    title: "Add a title before you save.",
    kind: "Add a type before you save.",
    body: "Add some text to the body before you save.",
  },
  saving: "Saving…",
  saved: "Saved.",
  unchanged: "No changes to save.",
  stale: "This concept changed after you opened it.",
  reload: "Reload the concept",
} as const;

export const SAID_OF_EDITING = {
  "reuse-unconfirmed": "This concept is now used in more places.",
  "stale-precondition": "This concept changed after you opened it. Reload it to see the change.",
  "unrecorded-head": "Nothing was saved. An earlier change is still saving.",
  "source-label-refused": "Enter the document’s name as the source, not a passage address.",
  "body-locator-refused":
    "The body cites a passage that isn’t in the sources. Remove the citation or add its source.",
  "path-taken": "This collection already has a concept with this title. Change the title.",
  "merge-key-taken":
    "A concept with this type and title already exists. Change the title or the type.",
  "rename-refused": "An edit can’t rename a concept. Change the title back.",
  "reclassification-refused": "An edit can’t change who can read this concept.",
  "no-such-concept": "This concept is no longer available. Go back to Search.",
  "owner-forbids": "Only the concept’s owner or an Admin can edit it. Suggest an edit instead.",
  malformed:
    "Something in this concept isn’t valid. Check the title, type, tags, sources and body.",
} satisfies OwnSentences;
