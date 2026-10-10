import { byCodeUnit } from "@better-answers/schema/code-unit";

import type { RefusedItems, UserId } from "../kernel/index.ts";

export type BulkOutcome<Id extends string = UserId> = {
  /** Each row the action changed, in id order. */
  readonly changed: readonly Id[];

  /** How many it left as they were: already so, or nothing here to change. */
  readonly skipped: number;
};

type Named<Word extends string> = readonly (readonly [string, Word])[];

export const namedEach = <Word extends string>(keys: readonly string[], word: Word): Named<Word> =>
  keys.map((key) => [key, word] as const);

/** The set's word is its first item's in id order, so no new word joins the catalogue. */
export const refusedItemsOf = <Word extends string>(
  named: Named<Word>,
): RefusedItems<Word> | undefined => {
  const [first] = named.toSorted(([one], [other]) => byCodeUnit(one, other));
  return first === undefined ? undefined : { word: first[1], items: Object.fromEntries(named) };
};

export const notAmong = <Id extends string>(
  asked: readonly Id[],
  found: readonly Id[],
): readonly Id[] => asked.filter((id) => !found.includes(id));

export const outcomeOf = <Id extends string>(
  asked: readonly Id[],
  changed: readonly Id[],
): BulkOutcome<Id> => ({
  changed,
  skipped: asked.length - changed.length,
});

/** A row ticked twice is asked for once. */
export const distinct = <Id extends string>(ids: readonly Id[]): readonly Id[] => [...new Set(ids)];
