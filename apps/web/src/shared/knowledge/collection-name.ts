import { CONCEPT_WORDS } from "./concept-words.ts";

export const collectionNameOf = (collection: string): string => {
  const spaced = collection.replaceAll(/[-_]/gu, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const collectionLabelOf = (collection: string | null | undefined): string =>
  collection == null ? CONCEPT_WORDS.noCollection : collectionNameOf(collection);
