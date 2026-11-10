const VOWEL = /[aeiouy]/iu;

const LETTER = /\p{L}/u;

const isAnAcronym = (word: string): boolean => LETTER.test(word) && !VOWEL.test(word);

const wordShown = (word: string): string => (isAnAcronym(word) ? word.toUpperCase() : word);

export const collectionNameOf = (collection: string): string => {
  const spaced = collection.split(/[-_]/u).map(wordShown).join(" ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

type Titled = {
  readonly collection: string;
  readonly subject: { readonly title: string } | null;
};

export const guideTitleOf = (guide: Titled): string =>
  guide.subject?.title ?? collectionNameOf(guide.collection);
