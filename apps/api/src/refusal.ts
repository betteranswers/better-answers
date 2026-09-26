import {
  declareRefusals,
  KERNEL_REFUSALS,
  type FieldIssues,
  type Malformed,
  type RefusalClass,
} from "@better-answers/core/kernel";
import { MEMBER_REFUSALS } from "@better-answers/core/members";
import { SOURCE_REFUSALS } from "@better-answers/core/sources";
import { WORKSPACE_REFUSALS } from "@better-answers/core/workspaces";

const TRANSPORT_REFUSALS = declareRefusals("transport", {
  "no-session": "unauthenticated",
  "no-active-workspace": "unauthenticated",
});

const REFUSALS = {
  ...KERNEL_REFUSALS,
  ...WORKSPACE_REFUSALS,
  ...MEMBER_REFUSALS,
  ...SOURCE_REFUSALS,
  ...TRANSPORT_REFUSALS,
};

export type RefusalWord = keyof typeof REFUSALS;

/** A malformed input is the kernel parse's own answer, which says which field and never the value. */
export type RefusalAnswer = RefusalWord | Malformed;

export type Refusal = {
  readonly word: RefusalWord;
  readonly class: RefusalClass;

  readonly fields?: FieldIssues | undefined;
};

export const refusalOf = (answered: RefusalAnswer): Refusal =>
  typeof answered === "string"
    ? { word: answered, class: REFUSALS[answered] }
    : { word: answered.word, class: REFUSALS[answered.word], fields: answered.fields };

export const isRefusalWord = (candidate: string | Error): candidate is RefusalWord =>
  typeof candidate === "string" && Object.hasOwn(REFUSALS, candidate);

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
