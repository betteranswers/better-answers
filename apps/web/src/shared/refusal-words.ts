import type { RefusalClass, RefusalWord } from "@/shared/api/trpc.ts";

/** What went wrong, then what the reader can do about it. */
export type Said = { readonly why: string; readonly next: string };

/** A feature's own words for the refusals it knows; any other word is said by its class. */
export type SaidOfWord = Partial<Record<RefusalWord, Said>>;

/** Only `forbidden` names who can act, because the reader can't. */
export const SAID_OF_CLASS = {
  unauthenticated: { why: "Your session has ended.", next: "Sign in again." },
  forbidden: {
    why: "Your role doesn't allow this.",
    next: "Ask an Admin of this workspace to do it.",
  },
  absent: {
    why: "What you acted on isn't here any more.",
    next: "Reload the page to see what is.",
  },
  malformed: {
    why: "What you sent couldn't be read, so nothing was saved.",
    next: "Check it and try again.",
  },
  inapplicable: { why: "This can't be done here.", next: "Choose something else to do." },
  conflict: {
    why: "This changed while you were working on it.",
    next: "Reload the page and try again.",
  },
  precondition: { why: "Something else has to happen first.", next: "Try again once it has." },
} satisfies Record<RefusalClass, Said>;

/** An act the api sent no word with: the network's failure, or an answer nothing could read. */
export const NO_RESPONSE: Said = {
  why: "No response, so nothing was saved.",
  next: "Try again in a moment.",
};

/** A read the api sent no word with, where nothing was being saved. */
export const NO_RESPONSE_TO_A_READ: Said = {
  why: "No response, so nothing is shown.",
  next: "Try again in a moment.",
};

export const saidOfRefusal = (
  featureWords: SaidOfWord,
  word: RefusalWord,
  refusalClass: RefusalClass,
): Said => featureWords[word] ?? SAID_OF_CLASS[refusalClass];

export const sentenceOf = (said: Said): string => `${said.why} ${said.next}`;
