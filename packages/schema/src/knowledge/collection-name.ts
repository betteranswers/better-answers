const VOWEL = /[aeiouy]/iu;

const ASCII_WORD = /^[a-z0-9]+$/iu;

const LETTER = /[a-z]/iu;

const isAnAcronym = (word: string): boolean =>
  ASCII_WORD.test(word) && LETTER.test(word) && !VOWEL.test(word);

const wordShown = (word: string): string => (isAnAcronym(word) ? word.toUpperCase() : word);

export const collectionNameOf = (collection: string): string => {
  const words = collection.split(/[-_]+/u).filter((word) => word !== "");
  if (words.length === 0) return collection;
  const spaced = words.map(wordShown).join(" ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

type Titled = {
  readonly collection: string;
  readonly subject: { readonly title: string } | null;
};

export const guideTitleOf = (guide: Titled): string =>
  guide.subject?.title ?? collectionNameOf(guide.collection);
