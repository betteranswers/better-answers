import type { RefusalWordFor, Vocabulary } from "../kernel/index.ts";

export const CONCEPT_REFUSALS = {
  "no-such-concept": "absent",
  "no-such-suggestion": "absent",

  "path-taken": "conflict",
  "merge-key-taken": "conflict",
  "manifest-taken": "conflict",
  "resolution-moved": "conflict",

  "kind-forbids": "forbidden",

  "class-unreadable": "forbidden",

  "rename-refused": "inapplicable",
  "reclassification-refused": "inapplicable",
  "unreadable-commit": "inapplicable",

  "no-such-repository": "precondition",
  "history-diverged": "precondition",

  held: "conflict",

  "stale-precondition": "conflict",
  "malformed-path": "malformed",
  "malformed-message": "malformed",
} as const satisfies Vocabulary;

type ConceptRefusal<W extends RefusalWordFor<typeof CONCEPT_REFUSALS>> = W;

export type PassedOnCommitRefusal = ConceptRefusal<
  "no-such-repository" | "stale-precondition" | "malformed-path" | "malformed-message"
>;
