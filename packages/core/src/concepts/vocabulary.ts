import type { RefusalWordFor, Vocabulary } from "../kernel/index.ts";

/**
 * The concepts slice borrows `widening-refused` and `no-such-document` from sources, and
 * `already-decided` and `no-such-group` from members.
 */
export const CONCEPT_REFUSALS = {
  "no-such-concept": "absent",
  "no-such-suggestion": "absent",

  "path-taken": "conflict",
  "merge-key-taken": "conflict",
  "manifest-taken": "conflict",
  "resolution-moved": "conflict",

  "kind-forbids": "forbidden",

  // The import's second pass reads back what it landed; someone cleared for the class runs it.
  "class-unreadable": "forbidden",

  // What the governed write never does: move a concept's file, change its class, or make a commit
  // the platform cannot read.
  "rename-refused": "inapplicable",
  "reclassification-refused": "inapplicable",
  "unreadable-commit": "inapplicable",

  // A person makes or restores the bundle repository, or reconciles its rewritten history, first.
  "no-such-repository": "precondition",
  "history-diverged": "precondition",

  // The git door's commit words, which a governed write passes on as its own.
  "stale-precondition": "conflict",
  "malformed-path": "malformed",
  "malformed-message": "malformed",
} as const satisfies Vocabulary;

type ConceptRefusal<W extends RefusalWordFor<typeof CONCEPT_REFUSALS>> = W;

/** The git door's `CommitRefusal` restated word for word, so each word it answers is classed. */
export type PassedOnCommitRefusal = ConceptRefusal<
  "no-such-repository" | "stale-precondition" | "malformed-path" | "malformed-message"
>;
