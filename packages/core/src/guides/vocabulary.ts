import type { Vocabulary } from "../kernel/index.ts";

export const GUIDE_REFUSALS = {
  "marker-without-include": "inapplicable",
  "below-action-threshold": "precondition",
} as const satisfies Vocabulary;
