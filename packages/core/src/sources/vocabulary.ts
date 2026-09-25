import { declareRefusals, type RefusalWordFor } from "../kernel/index.ts";
import type { MemberRefusal } from "../members/index.ts";

export const SOURCE_REFUSALS = declareRefusals("sources", {
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
});

/** A binding's audience names groups, which the members slice owns and declares. */
type BorrowedFromMembers = MemberRefusal<"no-such-group">;

export type SourceRefusal<W extends RefusalWordFor<typeof SOURCE_REFUSALS> | BorrowedFromMembers> =
  W;
