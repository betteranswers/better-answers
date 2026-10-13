import type { OwnSentences } from "@/shared/refusal-words.ts";

import { STATE_WORDS, UPLOAD_CAP_MB } from "./words.ts";

export const SAID_OF_A_CONNECTED_SOURCE = {
  "already-published": "This connected source is already published.",
  "not-indexed": `This connected source is still syncing. You can publish once it reads ${STATE_WORDS.indexed}.`,
  "confirmation-missing": "Please tick all three confirmations.",
  "special-category-unreviewed":
    "Please review the special category findings before widening this connected source.",
  "media-type-refused":
    "File type isn't supported. Please choose a Markdown, plain text, Word (.docx) or PDF file.",
  "too-large": `File must be ${UPLOAD_CAP_MB} MB or smaller.`,
  "not-the-always-set": "Only findings in the always set can be kept in text.",
  "not-special-category": "Only special category findings can be dismissed this way.",
  "widening-refused": "Please choose a narrower sensitivity.",
  "not-wider": "Please choose a wider sensitivity or audience.",
  "no-such-group":
    "One of those groups doesn't exist. Please use the groups listed on the People page.",
} satisfies OwnSentences;
