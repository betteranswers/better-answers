import type { OwnSentences } from "@/shared/refusal-words.ts";

/**
 * The api's rule holds the limit; this is the number a page tells the reader before they type.
 */
export const DISPLAY_NAME_MAX_CHARACTERS = 100;

export const DISPLAY_NAME_WORDS = {
  heading: "Your Name",
  label: "Display Name",
  hint: "This will be visible to members of every workspace you join.",
} as const;

export const DISPLAY_NAME_REFUSED = {
  "display-name-empty": "Please enter a display name.",
  "display-name-not-one-line": "Display name must be on one line.",
  "display-name-control-character": "Display name can't contain special characters such as tabs.",
  "display-name-angle-bracket": "Display name can't contain < or >.",
  "display-name-too-long": `Display name must be ${DISPLAY_NAME_MAX_CHARACTERS} characters or fewer.`,
} satisfies OwnSentences;
