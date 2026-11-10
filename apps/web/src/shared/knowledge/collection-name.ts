export const collectionNameOf = (collection: string): string => {
  const spaced = collection.replaceAll(/[-_]/gu, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
