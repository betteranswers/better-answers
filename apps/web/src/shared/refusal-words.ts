import type { RefusalClass, RefusalWord } from "@/shared/api/trpc.ts";
import { minutesUntil } from "@/shared/words.ts";

/** The sentence each kind of failure shows unless a feature lists its own. */
export const STOCK = {
  session: "Your session has expired. Please sign in again.",
  permission: "You don't have permission to do this.",
  gone: "This is no longer available. Please reload the page.",
  invalid: "Please check your entries and try again.",
  unavailable: "This action isn't available.",
  changed: "This has changed since you opened it. Please reload the page.",
  notYet: "This can't be done yet.",
  general: "Something went wrong. Please try again.",
  tryAgain: "There was a problem processing your request. Please try again.",
  unconfirmed: "We couldn't confirm that. Please reload the page to check.",
  notLoaded: "This didn't load. Please try again.",
  copy: "Couldn't copy. Please select it and copy it manually.",
} as const;

/** Names nobody, because the ceiling met is not always the reader's own. */
export const stockWait = (liftsInSeconds: number | undefined): string =>
  liftsInSeconds === undefined
    ? "Too many attempts. Please try again later."
    : `Too many attempts. Please try again in ${minutesUntil(liftsInSeconds)}.`;

const STOCK_OF_CLASS = {
  unauthenticated: STOCK.session,
  forbidden: STOCK.permission,
  absent: STOCK.gone,
  malformed: STOCK.invalid,
  inapplicable: STOCK.unavailable,
  conflict: STOCK.changed,
  precondition: STOCK.notYet,
} satisfies Record<RefusalClass, string>;

/** The api's answer is typed and never parsed, so a newer api's class can be in no table. */
const stockOfClass = (refusalClass: RefusalClass): string =>
  Object.hasOwn(STOCK_OF_CLASS, refusalClass) ? STOCK_OF_CLASS[refusalClass] : STOCK.general;

/** The words a feature gives a sentence of its own; any other word shows its class's stock sentence. */
export type OwnSentences = Partial<Record<RefusalWord, string>>;

/** The same on every surface, so no feature lists it and its class's reload is never asked for. */
const OWN_ON_EVERY_SURFACE = {
  "workspace-switched":
    "You switched workspace in another tab, so this tab now shows that workspace.",
} satisfies OwnSentences;

/** The feature's own sentence for the word, else the stock sentence of the word's class. */
export const refusalSentence = (
  own: OwnSentences,
  word: RefusalWord,
  refusalClass: RefusalClass,
): string => ({ ...OWN_ON_EVERY_SURFACE, ...own })[word] ?? stockOfClass(refusalClass);

/** The label of each control that takes an ended or stale session to sign in. */
export const SIGN_IN_AGAIN = "Sign In Again";
