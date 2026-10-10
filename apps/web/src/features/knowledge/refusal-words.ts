import type { Said, SaidOfWord } from "@/shared/refusal-words.ts";
import { minutesUntil } from "@/shared/words.ts";

/** An absent passage and a withheld one are one word, so neither sentence may say which. */
export const SAID_OF_KNOWLEDGE = {
  "not-found": {
    why: "Nothing you can read is there.",
    next: "Search again to see what is.",
  },
  malformed: {
    why: "That search couldn't be read.",
    next: "Change it and search again.",
  },
} satisfies SaidOfWord;

/** A ceiling crosses with no word, so the wait it names is what the page says. */
export const readsCeiling = (liftsInSeconds: number): Said => ({
  why: "You have searched and opened this workspace's knowledge too often this minute, so nothing new is shown.",
  next: `Try again in ${minutesUntil(liftsInSeconds)}.`,
});
