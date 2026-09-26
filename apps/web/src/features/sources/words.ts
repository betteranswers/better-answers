export { instantWords } from "@/shared/words.ts";

import type { ListedBinding } from "./sources-api.ts";

type Meaning = { readonly word: string; readonly means: string };

export const STATE_MEANS = {
  landed: "Its documents are in the object store; no run has turned them into chunks yet.",
  indexing: "A run is turning its documents into chunks.",
  indexed: "The run has finished and there is something to review.",
  published: "Its chunks reach the readers in its audience.",
} satisfies Record<ListedBinding["state"], string>;

export const AUDIENCE_WORDS = {
  everyone: "Everyone in the workspace",
  groups: "Named groups",
} satisfies Record<ListedBinding["audience"], string>;

/** The empty list's one line: the toolbar's Bind a document is how a document is bound. */
export const NOTHING_BOUND = "No document is bound yet.";

const DESTINATIONS = new Map<string, Meaning>([
  [
    "chunk-index",
    {
      word: "searchable",
      means: "Its passages are found by search and opened by the readers it is published to.",
    },
  ],
  [
    "bundle",
    {
      word: "bundle",
      means: "Concepts drawn from it arrive as suggestions an Admin accepts, once extraction runs.",
    },
  ],
  ["graph", { word: "map", means: "The people, meetings and tasks it names join the map." }],
]);

const RETENTIONS = new Map<string, Meaning>([
  [
    "mirror",
    {
      word: "mirror",
      means:
        "The source holds the record; a document gone at source loses its chunks after a grace period.",
    },
  ],
  [
    "keep",
    {
      word: "keep",
      means: "The platform holds the record; nothing leaves without an Admin's act.",
    },
  ],
  [
    "transient",
    {
      word: "transient",
      means: "The original is deleted once processed; the normalised redacted text is kept.",
    },
  ],
]);

/** A word the vocabulary has not met is shown as itself rather than dropped. */
const meaningIn = (vocabulary: ReadonlyMap<string, Meaning>, word: string): Meaning =>
  vocabulary.get(word) ?? { word, means: "" };

export const destinationOf = (word: string): Meaning => meaningIn(DESTINATIONS, word);

export const retentionOf = (word: string): Meaning => meaningIn(RETENTIONS, word);

/**
 * The api's cap, stated not imported: the web takes nothing from the api at runtime, and the api
 * refuses a larger file alike.
 */
export const UPLOAD_CAP_MB = 64;

export const NEEDS_OCR = "NeedsOcrError";

const QUARANTINE_WORDS = new Map([
  [NEEDS_OCR, "needs OCR"],
  ["DeadlineExceededError", "took too long"],
]);

export const quarantineWordOf = (error: string): string =>
  QUARANTINE_WORDS.get(error) ?? "could not be read";

/** The publish row carries one count per category the seam can raise, a zero included. */
export const AUDITED_CATEGORIES = [
  "special-category",
  "bank-details",
  "government-identifier",
  "date-of-birth",
  "home-address",
  "personal-contact",
  "person-name",
  "job-title",
] as const;

/** A category's or a tier's word is kebab-case on the row and spaced on the screen. */
export const spokenWord = (word: string): string => word.replaceAll("-", " ");
