import type { RefusalWord } from "@/shared/api/trpc.ts";
import { DISPLAY_NAME_REFUSED } from "@/shared/display-name-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";

/**
 * What every console action answers a person without the mark; their standing read says so without
 * asking one.
 */
export const NOT_THE_OPERATOR = "not-the-operator" satisfies RefusalWord;

export const SIGN_IN_TOO_OLD = "sign-in-too-old" satisfies RefusalWord;

/** The operator's writes ask for a recent sign-in, which the stock sentence would not say. */
export const SAID_OF_A_REVOCATION = {
  [SIGN_IN_TOO_OLD]: "Please sign in again to do this. Your sign-in must be less than an hour old.",
} satisfies OwnSentences;

/** The rule's own sentences, for a name the operator types for someone else. */
export const SAID_OF_CORRECTING = {
  ...DISPLAY_NAME_REFUSED,
  ...SAID_OF_A_REVOCATION,
} satisfies OwnSentences;
