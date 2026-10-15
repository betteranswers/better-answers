import type { RefusalWord } from "@/shared/api/trpc.ts";
import { DISPLAY_NAME_REFUSED } from "@/shared/display-name-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";

/**
 * What every console action answers a person without the mark; their standing read says so without
 * asking one.
 */
export const NOT_THE_OPERATOR = "not-the-operator" satisfies RefusalWord;

/** The rule's own sentences, for a name the operator types for someone else. */
export const SAID_OF_CORRECTING = DISPLAY_NAME_REFUSED satisfies OwnSentences;
