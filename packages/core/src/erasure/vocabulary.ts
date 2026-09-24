import { declareRefusals, type RefusalWordFor } from "../kernel/index.ts";

const ERASURE_REFUSALS = declareRefusals("erasure", {
  "identifier-too-broad": "inapplicable",
});

export type ErasureRefusal<W extends RefusalWordFor<typeof ERASURE_REFUSALS>> = W;

export const IDENTIFIER_TOO_BROAD =
  "identifier-too-broad" satisfies ErasureRefusal<"identifier-too-broad">;
