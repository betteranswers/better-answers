import { declareRefusals, type RefusalWordFor } from "../kernel/index.ts";

export const ERASURE_REFUSALS = declareRefusals("erasure", {
  "identifier-too-broad": "inapplicable",
  "not-an-erasure": "inapplicable",

  // The rehearsal's first phase seeds its subject; an erasure needs an address to rewrite.
  "not-seeded": "precondition",
  "no-address": "precondition",
});

export type ErasureRefusal<W extends RefusalWordFor<typeof ERASURE_REFUSALS>> = W;

export const IDENTIFIER_TOO_BROAD =
  "identifier-too-broad" satisfies ErasureRefusal<"identifier-too-broad">;
