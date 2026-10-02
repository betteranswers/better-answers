/** Whole characters as a reader sees them, so an emoji or an accent typed apart is never split. */
const CHARACTERS =
  "Segmenter" in Intl ? new Intl.Segmenter("en-GB", { granularity: "grapheme" }) : undefined;

/**
 * Some browsers still lack the segmenter. This keeps a flag, an accent typed apart and a joined
 * emoji whole there; rarer clusters may still split.
 */
const FIRST_CLUSTER = /^(?:\p{RI}{2}|\P{M}\p{M}*(?:‍\P{M}\p{M}*)*)/u;

const firstOf = (word: string): string =>
  CHARACTERS === undefined
    ? (FIRST_CLUSTER.exec(word)?.[0] ?? "")
    : ([...CHARACTERS.segment(word)][0]?.segment ?? "");

export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => firstOf(part).toUpperCase())
    .join("");
