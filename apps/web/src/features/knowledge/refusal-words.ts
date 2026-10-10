import type { SaidOfWord } from "@/shared/refusal-words.ts";

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
