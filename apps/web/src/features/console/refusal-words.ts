import type { RefusalWord } from "@/shared/api/trpc.ts";
import { DISPLAY_NAME_REFUSED } from "@/shared/member/display-name-words.ts";
import type { OwnSentences } from "@/shared/refusal-words.ts";

export const NOT_THE_OPERATOR = "not-the-operator" satisfies RefusalWord;

export const SAID_OF_CORRECTING = DISPLAY_NAME_REFUSED satisfies OwnSentences;
