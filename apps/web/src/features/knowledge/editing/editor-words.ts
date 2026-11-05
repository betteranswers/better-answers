import type { OwnSentences } from "@/shared/refusal-words.ts";

import { LAUNCH_WORDS } from "../knowledge-words.ts";

export const EDITOR_WORDS = {
  ...LAUNCH_WORDS,
  headingEdit: "Edit This Concept",
  headingSuggest: "Suggest an Edit",
  headingNew: "New Concept",
  title: "Title",
  kind: "Kind",
  description: "Description",
  tags: "Tags",
  tagsHint: "Separate tags with commas.",
  collection: "Collection",
  chooseCollection: "Choose a collection",
  body: "Body",
  sources: "Sources",
  sourcesNumbered: "Sources are numbered in this order, and the body cites them by number.",
  source: (number: number): string => `Source ${String(number)}`,
  remove: "Remove",
  removeSource: (number: number): string => `Remove source ${String(number)}`,
  addSource: "Add a source",
  withheld: (count: number): string =>
    count === 1
      ? "1 source you cannot open stays as it is"
      : `${String(count)} sources you cannot open stay as they are`,
  editAs: "Edit as",
  visual: "Visual",
  markdown: "Markdown",
  lossy: "This text uses markdown the visual editor would change, so it opens as markdown.",
  warning: "Warning",
  commits: "Saving changes this concept for everyone who reads it.",
  commitsNew: (collection: string): string =>
    `Saving adds this concept for everyone who can read ${collection}.`,
  suggests: "Saving sends your edit to the concept's owner. Nothing changes until they decide.",
  reuse: (places: number): string =>
    `It is used in ${String(places)} places, and each one will show the change.`,
  save: "Save",
  keepEditing: "Keep editing",
  close: "Close editor",
  leave: "Leave",
  leaving: "You have changes that are not saved.",
  cannotSave: {
    collection: "Choose a collection before you save.",
    title: "Add a title before you save.",
    kind: "Add a kind before you save.",
    body: "Add some text to the body before you save. A concept cannot be saved empty.",
  },
  saving: "Saving.",
  saved: "Saved.",
  unchanged: "Nothing changed, so nothing was saved.",
  stale: "This concept changed after you opened it.",
  reload: "Reload the concept",
} as const;

export const SAID_OF_EDITING = {
  "reuse-unconfirmed":
    "This concept is now used in more places than when you pressed Save. Please check how many, then save again.",
  "stale-precondition":
    "This concept changed after you opened it. Please reload it to see the change.",
  "source-label-refused":
    "A source is written as the address of a passage. Please name the document it comes from instead.",
  "body-locator-refused":
    "The body refers to a passage that is not in the sources. Please remove that reference, or add its source.",
  "path-taken":
    "A concept with that title already exists in this collection. Please change the title.",
  "merge-key-taken":
    "A concept with the same kind and title already exists. Please change the title or the kind.",
  "rename-refused":
    "An edit cannot move a concept to a new place. Please undo the change to its title.",
  "reclassification-refused": "An edit cannot change who is allowed to read this concept.",
  "no-such-concept": "This concept is no longer available. Please go back to Search.",
  "owner-forbids":
    "Only this concept's owner or an Admin can change it directly. Please suggest an edit instead.",
  malformed:
    "Something in this concept is not valid. Please check the title, kind, tags, sources and body, then try again.",
} satisfies OwnSentences;
