import type { SaidOfWord } from "@/shared/refusal-words.ts";

/**
 * The api's rule holds the limit; this is the number a screen tells the reader before they type.
 */
export const DISPLAY_NAME_MAX_CHARACTERS = 100;

/** Wherever a person gives their own name: the display-name screen and the invitation screen. */
export const DISPLAY_NAME_WORDS = {
  heading: "Your name",
  label: "Display name",
  hint: "Members of every workspace you join see this name.",
} as const;

/** The rule's own refusals, said the same wherever a display name is typed. */
export const DISPLAY_NAME_REFUSED = {
  "display-name-empty": {
    why: "A display name needs a character other than a space.",
    next: "Type the name you want to be credited by.",
  },
  "display-name-not-one-line": {
    why: "A display name is one line.",
    next: "Remove the line break and save again.",
  },
  "display-name-control-character": {
    why: "A display name cannot hold a control character, such as a tab.",
    next: "Type it again rather than pasting it.",
  },
  "display-name-angle-bracket": {
    why: "A display name cannot hold < or >.",
    next: "Remove them and save again.",
  },
  "display-name-too-long": {
    why: `A display name is at most ${DISPLAY_NAME_MAX_CHARACTERS} characters.`,
    next: "Shorten it and save again.",
  },
} satisfies SaidOfWord;
