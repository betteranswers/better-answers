/** Spelled in two halves, so the tag scan does not read a fixture as a citation. */
export const tag = (family: string, number: string): string => `[${family}${number}]`;

/** `word1` to `word<count>`, space-separated, so no two words in a fixture repeat. */
export const wordsOf = (count: number): string =>
  Array.from({ length: count }, (_unused, index) => `word${String(index + 1)}`).join(" ");
