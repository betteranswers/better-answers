const CHARACTERS =
  "Segmenter" in Intl ? new Intl.Segmenter("en-GB", { granularity: "grapheme" }) : undefined;

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
