const VOWEL = /[aeiouy]/iu;

const LETTER = /\p{L}/u;

/** A word with letters and no vowel, such as "hr" or "gdpr", is an acronym. */
const wordShown = (word: string): string =>
  LETTER.test(word) && !VOWEL.test(word) ? word.toUpperCase() : word;

/** A collection's display name. Its address, filters and the api keep the slug. */
export const collectionNameOf = (collection: string): string => {
  const spaced = collection.split(/[-_]/u).map(wordShown).join(" ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

type Titled = {
  readonly collection: string;
  readonly subject: { readonly title: string } | null;
};

/** A guide is titled by its subject, or by its collection's display name where it has none. */
export const guideTitleOf = (guide: Titled): string =>
  guide.subject?.title ?? collectionNameOf(guide.collection);
