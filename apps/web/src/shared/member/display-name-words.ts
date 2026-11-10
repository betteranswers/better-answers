import type { OwnSentences } from "@/shared/refusal-words.ts";

export const DISPLAY_NAME_MAX_CHARACTERS = 100;

export const DISPLAY_NAME_WORDS = {
  heading: "Your name",
  label: "Display name",
  hint: "Shown to members of every workspace you join.",
  save: "Save and continue",
} as const;

export const DISPLAY_NAME_REFUSED = {
  "display-name-empty": "Enter a display name.",
  "display-name-not-one-line": "Display name must be on one line.",
  "display-name-control-character": "Display name can’t contain special characters such as tabs.",
  "display-name-angle-bracket": "Display name can’t contain < or >.",
  "display-name-too-long": `Display name must be ${DISPLAY_NAME_MAX_CHARACTERS} characters or fewer.`,
} satisfies OwnSentences;
