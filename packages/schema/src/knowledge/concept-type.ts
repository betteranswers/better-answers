export const foldConceptType = (conceptType: string): string =>
  conceptType.replaceAll(/\S+/gu, (word) => {
    const head = word.charAt(0).toUpperCase();
    const cased = head.charAt(0) + (head.slice(1) + word.slice(1)).toLowerCase();
    if (cased.endsWith("ies")) return `${cased.slice(0, -3)}y`;
    if (/(x|z|ch|sh|ss|us|is)es$/u.test(cased)) return cased.slice(0, -2);
    if (/(ss|us|is)$/u.test(cased) || !cased.endsWith("s")) return cased;
    return cased.slice(0, -1);
  });
