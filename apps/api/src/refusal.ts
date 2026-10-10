import {
  classesIn,
  type FieldIssues,
  type Malformed,
  type RefusalClass,
  type RefusedItems,
} from "@better-answers/core/kernel";
import { REFUSAL_CATALOGUE } from "@better-answers/core/refusals";

const REFUSALS = classesIn({
  ...REFUSAL_CATALOGUE,
  transport: { "no-session": "unauthenticated", "no-active-workspace": "unauthenticated" },
});

export type RefusalWord = keyof typeof REFUSALS;

export const REFUSAL_WORDS = Object.keys(REFUSALS);

/** A malformed input is the kernel parse's own answer, which says which field and never the value. */
export type RefusalAnswer = RefusalWord | Malformed | RefusedItems<RefusalWord>;

type ItemWords = RefusedItems<RefusalWord>["items"];

type Detail =
  | { readonly fields: FieldIssues; readonly items?: never }
  | { readonly fields?: never; readonly items: ItemWords };

/** One detail at most, so no reader meets fields and items together. */
export type Refusal = { readonly word: RefusalWord; readonly class: RefusalClass } & (
  | { readonly fields?: never; readonly items?: never }
  | Detail
);

/** By its shape, not its word: `malformed` is also an item's word. */
const detailOf = (answered: Malformed | RefusedItems<RefusalWord>): Detail =>
  "fields" in answered ? { fields: answered.fields } : { items: answered.items };

export const refusalOf = (answered: RefusalAnswer): Refusal =>
  typeof answered === "string"
    ? { word: answered, class: REFUSALS[answered] }
    : { word: answered.word, class: REFUSALS[answered.word], ...detailOf(answered) };

/** Word and class alone, so a refusal naming items logs no id of the people it names. */
export const refusalLogged = (refusal: Refusal) => ({
  refusal: refusal.word,
  class: refusal.class,
});

/** Empty without fields; otherwise a sentence with its leading space, to append to a message. */
export const fieldsSaid = (refusal: Refusal): string =>
  refusal.fields === undefined
    ? ""
    : ` Fields: ${Object.entries(refusal.fields)
        .map(([path, issue]) => `${path} ${issue}`)
        .join(", ")}.`;

/**
 * The refusal rides the protocol error's cause, the one field handed back untouched; a message
 * alone would lose a malformed input's fields.
 */
export class RefusedError extends Error {
  readonly refusal: Refusal;

  constructor(refusal: Refusal) {
    super(refusal.word);
    this.name = "RefusedError";
    this.refusal = refusal;
  }
}
