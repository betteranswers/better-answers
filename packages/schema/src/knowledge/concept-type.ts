const SINGULARS_ENDING_IN_S = [
  "Alias",
  "Atlas",
  "Bias",
  "Canvas",
  "Chaos",
  "Ethos",
  "Gas",
  "Lens",
  "News",
  "Series",
  "Species",
];

const SINGULAR_OF = new Map(
  SINGULARS_ENDING_IN_S.flatMap((singular) => [
    [singular, singular],
    [`${singular}es`, singular],
  ]),
);

const singularOf = (cased: string): string => {
  const listed = SINGULAR_OF.get(cased);
  if (listed !== undefined) return listed;
  if (cased.endsWith("ies")) return `${cased.slice(0, -3)}y`;
  if (/(x|z|ch|sh|ss|us|is)es$/u.test(cased)) return cased.slice(0, -2);
  if (/(ss|us|is)$/u.test(cased) || !cased.endsWith("s")) return cased;
  return cased.slice(0, -1);
};

export const foldConceptType = (conceptType: string): string =>
  conceptType.replaceAll(/\S+/gu, (word) => {
    const head = word.charAt(0).toUpperCase();
    return singularOf(head.charAt(0) + (head.slice(1) + word.slice(1)).toLowerCase());
  });
