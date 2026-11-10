import type { OwnSentences } from "@/shared/refusal-words.ts";

import { STATE_WORDS, UPLOAD_CAP_MB } from "./words.ts";

export const SAID_OF_A_CONNECTED_SOURCE = {
  "already-published": "This connected source is already published.",
  "not-indexed": `This connected source is still syncing. Publish it once its state is ${STATE_WORDS.indexed}.`,
  "confirmation-missing": "Tick all three confirmations.",
  "special-category-unreviewed":
    "Review the special category findings before you widen this connected source.",
  "media-type-refused":
    "This file type isn’t supported. Choose a Markdown, plain text, Word (.docx) or PDF file.",
  "too-large": `File must be ${UPLOAD_CAP_MB} MB or smaller.`,
  "not-the-always-set": "Only findings marked Always can be kept in text.",
  "not-special-category": "Only special category findings can be dismissed this way.",
  "widening-refused": "Choose a narrower sensitivity.",
  "not-wider": "Choose a wider sensitivity or audience.",
  "no-such-group": "One of those groups doesn’t exist. Choose a group from the Groups page.",
} satisfies OwnSentences;
