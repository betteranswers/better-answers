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
  addSource: "Add a Source",
  withheld: (count: number): string =>
    count === 1
      ? "1 source you can’t open won’t be changed"
      : `${String(count)} sources you can’t open won’t be changed`,
  editAs: "Edit as",
  visual: "Visual",
  markdown: "Markdown",
  lossy: "This text uses markdown the visual editor would change, so it opens as markdown.",
  warning: "Warning",
  commits: "When you save, everyone who can read this concept sees the change.",
  commitsNew: (collection: string): string =>
    `When you save, everyone who can read ${collection} can see this concept.`,
  suggests:
    "When you save, your edit is sent to the concept’s owner for review. Nothing changes until they accept it.",
  suggestsNew:
    "When you save, your new concept is sent to the collection’s owner or an Admin for review. Nothing is added until they accept it.",
  reuse: (places: number): string =>
    `This concept is used in ${String(places)} places. Each one will show the change.`,
  save: "Save",
  keepEditing: "Keep Editing",
  close: "Close Editor",
  leave: "Leave",
  leaving: "You have unsaved changes.",
  cannotSave: {
    collection: "Choose a collection before you save.",
    title: "Add a title before you save.",
    kind: "Add a kind before you save.",
    body: "Add some text to the body before you save.",
  },
  saving: "Saving.",
  saved: "Saved.",
  unchanged: "There are no changes to save.",
  stale: "This concept changed after you opened it.",
  reload: "Reload the Concept",
} as const;

export const SAID_OF_EDITING = {
  "reuse-unconfirmed":
    "This concept is now used in more places than when you pressed Save. Please check how many, then save again.",
  "stale-precondition":
    "This concept changed after you opened it. Please reload it to see the change.",
  "unrecorded-head":
    "This workspace is still saving an earlier change. Nothing was saved. Please save again in a minute.",
  "source-label-refused":
    "A source can’t be the address of a passage. Please enter the name of its document instead.",
  "body-locator-refused":
    "The body refers to a passage that is not in the sources. Please remove that reference, or add its source.",
  "path-taken":
    "A concept with that title already exists in this collection. Please change the title.",
  "merge-key-taken":
    "A concept with the same kind and title already exists. Please change the title or the kind.",
  "rename-refused": "An edit can’t rename a concept. Please change the title back.",
  "reclassification-refused": "An edit can’t change who can read this concept.",
  "no-such-concept": "This concept is no longer available. Please go back to Search.",
  "owner-forbids":
    "Only this concept's owner or an Admin can change it directly. Please suggest an edit instead.",
  malformed:
    "Something in this concept is not valid. Please check the title, kind, tags, sources and body, then try again.",
} satisfies OwnSentences;
