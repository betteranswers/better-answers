import { instantWords } from "@/shared/words.ts";

import type { ListedConnectedSource } from "./sources-api.ts";

export { instantWords };

type Meaning = { readonly word: string; readonly means: string };

export const STATE_MEANS = {
  received: "Its documents have been received; no sync has turned them into passages yet.",
  indexing: "A sync is turning its documents into passages.",
  indexed: "The sync has finished and there is something to review.",
  published: "Its passages reach the readers in its audience.",
} satisfies Record<ListedConnectedSource["state"], string>;

type Sync = NonNullable<ListedConnectedSource["lastSync"]>;

const SYNC_SAYS = {
  queued: "Sync queued",
  claimed: "Syncing",
  failed: "Sync failed",
  poisoned: "Sync failed",
} satisfies Record<Exclude<Sync["status"], "done">, string>;

/** The Last synced row: a finished sync's time alone, and any other sync's state before its time. */
export const lastSyncedWords = (lastSync: Sync | null): string => {
  if (lastSync === null) return "Not synced yet";
  const when = instantWords(lastSync.finishedAt ?? lastSync.enqueuedAt);
  return lastSync.status === "done" ? when : `${SYNC_SAYS[lastSync.status]} · ${when}`;
};

export const AUDIENCE_WORDS = {
  everyone: "Everyone in the workspace",
  groups: "Named groups",
} satisfies Record<ListedConnectedSource["audience"], string>;

/** The empty list's one line: the toolbar's Connect a document is how a document is connected. */
export const NOTHING_CONNECTED = "No document is connected yet.";

const DESTINATIONS = new Map<string, Meaning>([
  [
    "passage-index",
    {
      word: "searchable",
      means: "Its passages are found by search and opened by the readers it is published to.",
    },
  ],
  [
    "bundle",
    {
      word: "knowledge base",
      means: "Concepts drawn from it arrive as suggestions an Admin accepts, once extraction runs.",
    },
  ],
  ["map", { word: "map", means: "The people, meetings and tasks it names join the map." }],
]);

const RETENTIONS = new Map<string, Meaning>([
  [
    "mirror",
    {
      word: "mirror",
      means:
        "The source holds the record; a document gone at source loses its passages after a grace period.",
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

const UNREADABLE_WORDS = new Map([
  [NEEDS_OCR, "needs OCR"],
  ["DeadlineExceededError", "took too long"],
]);

export const unreadableWordOf = (error: string): string =>
  UNREADABLE_WORDS.get(error) ?? "could not be read";

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

/** A category's or a tier's word is kebab-case on the row and spaced on the page. */
export const spokenWord = (word: string): string => word.replaceAll("-", " ");
