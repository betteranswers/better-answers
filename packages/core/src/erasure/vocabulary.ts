import type { RefusalWordFor, Vocabulary } from "../kernel/index.ts";

export const ERASURE_REFUSALS = {
  "identifier-too-broad": "inapplicable",
  "not-an-erasure": "inapplicable",

  // The rehearsal's first phase seeds its subject; an erasure needs an address to rewrite.
  "not-seeded": "precondition",
  "no-address": "precondition",
} as const satisfies Vocabulary;

export type ErasureRefusal<W extends RefusalWordFor<typeof ERASURE_REFUSALS>> = W;

export const IDENTIFIER_TOO_BROAD =
  "identifier-too-broad" satisfies ErasureRefusal<"identifier-too-broad">;
