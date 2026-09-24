import {
  SUBJECT_IDENTIFIER_FLOOR,
  type SUBJECT_IDENTIFIER_KINDS,
  SUBJECT_NAME_WORDS_FLOOR,
} from "@better-answers/schema";

type IdentifierKind = (typeof SUBJECT_IDENTIFIER_KINDS)[number];

type Floor = "characters" | "name-words";

const SPACE = " ";

// The worker splits on Python's whitespace, which is not JavaScript's `\s`: it holds the
// four separator controls and NEL, and not the byte-order mark.
const WHITESPACE_RANGES: readonly (readonly [number, number])[] = [
  [0x09, 0x0d],
  [0x1c, 0x20],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

const WHITESPACE = new Set(
  WHITESPACE_RANGES.flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, at) => String.fromCodePoint(from + at)),
  ),
);

const DOTLESS_I = "\u0131";

const CHEROKEE_SMALL_LETTERS = { from: 0xab70, to: 0xabbf, capital: 0x13a0 };
const CHEROKEE_SMALL_LETTERS_BEYOND = { from: 0x13f8, to: 0x13fd, capital: 0x13f0 };

// Cherokee folds a small letter to its capital, where lower-casing goes the other way.
const cherokeeCapitalOf = (character: string): string => {
  const point = character.codePointAt(0) ?? 0;
  const range = [CHEROKEE_SMALL_LETTERS, CHEROKEE_SMALL_LETTERS_BEYOND].find(
    (letters) => letters.from <= point && point <= letters.to,
  );
  return range === undefined ? character : String.fromCodePoint(range.capital + point - range.from);
};

// Per character, so no final sigma is written; down, up and down again is full case folding
// for all but dotless i and Cherokee.
const foldedCharacter = (character: string): string =>
  character === DOTLESS_I
    ? character
    : Array.from(character.toLowerCase().toUpperCase().toLowerCase(), cherokeeCapitalOf).join("");

// A folded character is never a space, so the words are found after folding.
export const normalisedIdentifier = (identifier: string): string =>
  Array.from(identifier, (character) =>
    WHITESPACE.has(character) ? SPACE : foldedCharacter(character),
  )
    .join("")
    .split(SPACE)
    .filter((word) => word !== "")
    .join(SPACE);

export const floorNotCleared = (kind: IdentifierKind, identifier: string): Floor | undefined => {
  const normalised = normalisedIdentifier(identifier);
  if (Array.from(normalised).length < SUBJECT_IDENTIFIER_FLOOR) return "characters";
  if (kind === "names" && normalised.split(" ").length < SUBJECT_NAME_WORDS_FLOOR) {
    return "name-words";
  }
  return undefined;
};
