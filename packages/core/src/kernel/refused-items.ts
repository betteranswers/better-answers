/**
 * Keyed by an id or address position the caller sent, never an address or name; the set's word is
 * the first item's by id.
 */
export type RefusedItems<Word extends string> = {
  readonly word: Word;

  readonly items: Readonly<Record<string, Word>>;
};
