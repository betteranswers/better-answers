import type { RefusalClass, RefusalWord } from "@/shared/api/trpc.ts";
import { minutesUntil } from "@/shared/words.ts";

export const STOCK = {
  session: "Your session has expired. Sign in again.",
  permission: "You don't have permission to do this.",
  gone: "This is no longer available. Reload the page.",
  invalid: "Check your entries and try again.",
  unavailable: "This action isn't available.",
  changed: "This has changed since you opened it. Reload the page.",
  notYet: "This can't be done yet.",
  general: "Something went wrong. Try again.",
  tryAgain: "We couldn't process your request. Try again.",
  unconfirmed: "We couldn't confirm that. Reload the page to check.",
  notLoaded: "This didn't load. Try again.",
  copy: "Couldn't copy. Select the text and copy it yourself.",
} as const;

export const stockWait = (liftsInSeconds: number | undefined): string =>
  liftsInSeconds === undefined
    ? "Too many attempts. Try again later."
    : `Too many attempts. Try again in ${minutesUntil(liftsInSeconds)}.`;

const STOCK_OF_CLASS = {
  unauthenticated: STOCK.session,
  forbidden: STOCK.permission,
  absent: STOCK.gone,
  malformed: STOCK.invalid,
  inapplicable: STOCK.unavailable,
  conflict: STOCK.changed,
  precondition: STOCK.notYet,
} satisfies Record<RefusalClass, string>;

const stockOfClass = (refusalClass: RefusalClass): string =>
  Object.hasOwn(STOCK_OF_CLASS, refusalClass) ? STOCK_OF_CLASS[refusalClass] : STOCK.general;

export type OwnSentences = Partial<Record<RefusalWord, string>>;

const OWN_ON_EVERY_SURFACE = {
  "workspace-switched": "This tab now shows the workspace you switched to in another tab.",
  "workspace-unnamed": "This tab couldn't load your workspace. Reload the page.",
  "confirmation-too-old":
    "Confirm your second factor again. Your last confirmation is over an hour old.",
} satisfies OwnSentences;

export const refusalSentence = (
  own: OwnSentences,
  word: RefusalWord,
  refusalClass: RefusalClass,
): string => ({ ...OWN_ON_EVERY_SURFACE, ...own })[word] ?? stockOfClass(refusalClass);

export const SIGN_IN_AGAIN = "Sign in again";
