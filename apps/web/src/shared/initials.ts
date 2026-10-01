/** Whole characters as a reader sees them, so an emoji or an accent typed apart is never split. */
const CHARACTERS =
  "Segmenter" in Intl ? new Intl.Segmenter("en-GB", { granularity: "grapheme" }) : undefined;

/**
 * Some browsers still lack the segmenter. Code points keep an emoji whole there, but drop an
 * accent typed apart.
 */
const firstOf = (word: string): string =>
  CHARACTERS === undefined
    ? (Array.from(word)[0] ?? "")
    : ([...CHARACTERS.segment(word)][0]?.segment ?? "");

export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => firstOf(part).toUpperCase())
    .join("");
