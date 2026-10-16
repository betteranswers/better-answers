export const wordsOf = (count: number): string =>
  Array.from({ length: count }, (_unused, index) => `word${String(index + 1)}`).join(" ");
