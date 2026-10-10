import type { RefusalWordFor, Vocabulary } from "../kernel/index.ts";
import type { MemberRefusal } from "../members/index.ts";

export const SOURCE_REFUSALS = {
  "no-such-binding": "absent",
  "no-such-document": "absent",
  "no-such-finding": "absent",

  "already-published": "conflict",

  "not-indexed": "precondition",
  "confirmation-missing": "precondition",
  "special-category-unreviewed": "precondition",

  "media-type-refused": "inapplicable",
  "too-large": "inapplicable",
  "not-the-always-set": "inapplicable",
  "not-special-category": "inapplicable",
  "widening-refused": "inapplicable",
  "not-wider": "inapplicable",
} as const satisfies Vocabulary;

/** A connected source's audience names groups, which the members slice owns and declares. */
type BorrowedFromMembers = MemberRefusal<"no-such-group">;

export type SourceRefusal<W extends RefusalWordFor<typeof SOURCE_REFUSALS> | BorrowedFromMembers> =
  W;
