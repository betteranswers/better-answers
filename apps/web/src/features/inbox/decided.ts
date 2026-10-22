import type { Decided, DecidedWord, WaitingItem, WaitingPerson } from "./inbox-api.ts";
import {
  DECIDED_WORDS,
  personWords,
  SAID_OF_ACCEPTING,
  WAITING_WORDS,
  type Returned,
} from "./inbox-words.ts";

export type Said = { readonly words: string; readonly refused: boolean };

export type ItemSaid = Said & { readonly suggestionId: string; readonly title: string };

const isReturned = (word: DecidedWord): word is Returned =>
  word === "stale-precondition" || word === "resolution-moved";

export const saidOfAccepting = (word: DecidedWord, proposer: WaitingPerson | null): Said => {
  if (word === "accepted") {
    return { words: DECIDED_WORDS.accepted(personWords(proposer)), refused: false };
  }
  if (isReturned(word)) {
    return { words: DECIDED_WORDS.returned(personWords(proposer)), refused: false };
  }
  return { words: SAID_OF_ACCEPTING[word], refused: true };
};

export const saidOfEach = (
  outcomes: readonly Decided[],
  items: readonly WaitingItem[],
): readonly ItemSaid[] =>
  outcomes.map(({ suggestionId, outcome }) => {
    const item = items.find((each) => each.suggestionId === suggestionId);
    return {
      suggestionId,
      title: item?.title ?? WAITING_WORDS.noLongerListed,
      ...saidOfAccepting(outcome, item?.proposer ?? null),
    };
  });

const GONE_FROM_THE_LIST: ReadonlySet<DecidedWord> = new Set([
  "already-decided",
  "no-such-suggestion",
]);

export const stillWaitingAfter = (word: DecidedWord): boolean =>
  word !== "accepted" && !isReturned(word) && !GONE_FROM_THE_LIST.has(word);

export const ownsNoLongerAny = (outcomes: readonly Decided[]): boolean =>
  outcomes.some(({ outcome }) => outcome === "owner-forbids");
