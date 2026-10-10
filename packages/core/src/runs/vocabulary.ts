import type { Vocabulary } from "../kernel/index.ts";

export const RUN_REFUSALS = {
  "no-such-job": "absent",
} as const satisfies Vocabulary;
