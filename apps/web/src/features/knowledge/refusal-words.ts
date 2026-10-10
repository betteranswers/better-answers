import type { Said, SaidOfWord } from "@/shared/refusal-words.ts";
import { minutesUntil } from "@/shared/words.ts";

/** An absent passage and a withheld one are one word, so neither sentence may say which. */
export const SAID_OF_KNOWLEDGE = {
  "not-found": {
    why: "Nothing you can read is there.",
    next: "Search again to see what is.",
  },
  malformed: {
    why: "That search couldn’t be read.",
    next: "Change it and search again.",
  },
} satisfies SaidOfWord;

/** A person's own ceiling and their address's cross alike, with no word, so this never says whose it was. */
export const readsCeiling = (liftsInSeconds: number): Said => ({
  why: "Too much has been asked this minute, so nothing new is shown.",
  next: `Try again in ${minutesUntil(liftsInSeconds)}.`,
});
