import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { EditRead } from "../knowledge-api.ts";
import { LAUNCH_WORDS } from "../knowledge-words.ts";

type PlacesUsing = EditRead["usedIn"];

export const EDITOR_WORDS = {
  ...LAUNCH_WORDS,
  headingEdit: "Edit concept",
  headingSuggest: "Suggest an edit",
  headingNew: "New concept",
  title: "Title",
  conceptType: "Type",
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
      ? "1 source you can’t open stays on this concept."
      : `${String(count)} sources you can’t open stay on this concept.`,
  editAs: "Edit as",
  visual: "Visual",
  markdown: "Markdown",
  lossy: "Edit this text in Markdown. It has parts the visual editor can’t show.",
  warning: "Warning",
  suggests: "Your edit goes to the concept’s owner or an Admin for review.",
  suggestsNew: "Your concept goes to the collection’s owner or an Admin for review.",
  reuse: ({ writeUps, linkingConcepts }: PlacesUsing): string => {
    const sections = counted(writeUps, "guide section", "guide sections");
    const concepts = counted(linkingConcepts, "other concept", "other concepts");
    if (linkingConcepts === 0)
      return `This concept is in ${sections}. Saving changes it there too.`;
    if (writeUps === 0) {
      return `This concept is linked from ${concepts}. Saving changes it there too.`;
    }
    return `This concept is in ${sections} and linked from ${concepts}. Saving changes it there too.`;
  },
  save: "Save",
  sendSuggestion: "Send suggestion",
  keepEditing: "Keep editing",
  close: "Close",
  kept: "Your changes are kept for when you reopen the editor.",
  leave: "Discard changes",
  leaving: "Discard your unsaved changes?",
  cannotSave: {
    collection: "Choose a collection before you save.",
    title: "Add a title before you save.",
    conceptType: "Add a type before you save.",
    body: "Add some text to the body before you save.",
  },
  saving: "Saving…",
  saved: "Saved.",
  unchanged: "No changes to save.",
  stale: "This concept changed after you opened it.",
  reload: "Reload the concept",
} as const;

export const SAID_OF_EDITING = {
  "reuse-unconfirmed": "Nothing was saved. More places now use this concept.",
  "stale-precondition": "This concept changed after you opened it. Reload it to see the change.",
  "unrecorded-head": "Nothing was saved. An earlier change is still saving.",
  "source-label-refused":
    "Nothing was saved. Use the document’s name as the source, such as Handbook.pdf.",
  "body-locator-refused":
    "Nothing was saved. Delete the reference code in the body, such as 01HX…/chars:0-40.",
  "path-taken": "This collection already has a concept with this title. Change the title.",
  "merge-key-taken":
    "A concept with this type and title already exists. Change the title or the type.",
  "rename-refused": "An edit can’t rename a concept. Change the title back.",
  "no-such-concept": "This concept is no longer available. Go back to Search.",
  "owner-forbids": "Only the concept’s owner or an Admin can edit it. Suggest an edit instead.",
  malformed:
    "Something in this concept isn’t valid. Check the title, type, tags, sources and body.",
} satisfies OwnSentences;
