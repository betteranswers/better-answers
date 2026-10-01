/** Whole characters as a reader sees them, so an emoji or an accent typed apart is never split. */
const CHARACTERS = new Intl.Segmenter("en-GB", { granularity: "grapheme" });

const firstOf = (word: string): string => [...CHARACTERS.segment(word)][0]?.segment ?? "";

export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => firstOf(part).toUpperCase())
    .join("");
