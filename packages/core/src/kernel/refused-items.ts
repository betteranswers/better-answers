export type RefusedItems<Word extends string> = {
  readonly word: Word;

  readonly items: Readonly<Record<string, Word>>;
};
