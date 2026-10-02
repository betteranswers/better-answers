/** `word1` to `word<count>`, space-separated, so no two words in a fixture repeat. */
export const wordsOf = (count: number): string =>
  Array.from({ length: count }, (_unused, index) => `word${String(index + 1)}`).join(" ");
