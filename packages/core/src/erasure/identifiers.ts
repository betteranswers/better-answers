import {
  SUBJECT_IDENTIFIER_FLOOR,
  SUBJECT_IDENTIFIER_KINDS,
  SUBJECT_NAME_WORDS_FLOOR,
} from "@better-answers/schema";

type IdentifierKind = (typeof SUBJECT_IDENTIFIER_KINDS)[number];

type Floor = "characters" | "name-words";

const SPACE = " ";

const EMAILS: IdentifierKind = "emails";

/**
 * The worker splits on Python's whitespace, which is not JavaScript's `\s`: it holds the
 * four separator controls and NEL, and not the byte-order mark.
 */
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

/**
 * Node's Unicode postdates the worker's 15.1, where these code points do not exist; the
 * agreement's digests fail when Node's Unicode moves.
 */
const ASSIGNED_AFTER_UNICODE_15_1 = `
  88F 897 C5C CDC 1ACF-1ADD 1AE0-1AEB 1B4E-1B4F 1B7F 1C89-1C8A 20C1 2427-2429 2B96 31E4-31E5
  A7CB-A7CF A7D2 A7D4 A7DA-A7DC A7F1 FBC3-FBD2 FD90-FD91 FDC8-FDCE 105C0-105F3 10940-10959
  10D40-10D65 10D69-10D85 10D8E-10D8F 10EC2-10EC7 10ED0-10ED8 10EFA-10EFC 11380-11389 1138B
  1138E 11390-113B5 113B7-113C0 113C2 113C5 113C7-113CA 113CC-113D5 113D7-113D8 113E1-113E2
  116D0-116E3 11B60-11B67 11BC0-11BE1 11BF0-11BF9 11DB0-11DDB 11DE0-11DE9 11F5A 13460-143FA
  16100-16139 16D40-16D79 16EA0-16EB8 16EBB-16ED3 16FF2-16FF6 187F8-187FF 18CFF 18D09-18D1E
  18D80-18DF2 1CC00-1CCFC 1CD00-1CEB3 1CEBA-1CED0 1CEE0-1CEF0 1E5D0-1E5FA 1E5FF 1E6C0-1E6DE
  1E6E0-1E6F5 1E6FE-1E6FF 1F6D8 1F777-1F77A 1F8B2-1F8BB 1F8C0-1F8C1 1F8D0-1F8D8 1FA54-1FA57
  1FA89-1FA8A 1FA8E-1FA8F 1FABE 1FAC6 1FAC8 1FACD 1FADC 1FADF 1FAE9-1FAEA 1FAEF 1FBCB-1FBEF
  1FBFA 2B73A-2B73F 2CEA2-2CEAD 323B0-33479`;

const UNKNOWN_TO_UNICODE_15_1 = new Set(
  ASSIGNED_AFTER_UNICODE_15_1.trim()
    .split(/\s+/)
    .flatMap((range) => {
      const [from = 0, to = from] = range.split("-").map((point) => Number.parseInt(point, 16));
      return Array.from({ length: to - from + 1 }, (_, at) => from + at);
    }),
);

const knownToUnicode15_1 = (character: string): boolean =>
  !UNKNOWN_TO_UNICODE_15_1.has(character.codePointAt(0) ?? 0);

const WORD_CHARACTER = /^[\p{L}\p{M}\p{N}]$/u;

const ADDRESS_JOINERS = new Set([".", "-", "_", "+"]);

const DOTLESS_I = "\u0131";

const CHEROKEE_SMALL_LETTERS = { from: 0xab70, to: 0xabbf, capital: 0x13a0 };
const CHEROKEE_SMALL_LETTERS_BEYOND = { from: 0x13f8, to: 0x13fd, capital: 0x13f0 };

/** Cherokee folds a small letter to its capital, where lower-casing goes the other way. */
const cherokeeCapitalOf = (character: string): string => {
  const point = character.codePointAt(0) ?? 0;
  const range = [CHEROKEE_SMALL_LETTERS, CHEROKEE_SMALL_LETTERS_BEYOND].find(
    (letters) => letters.from <= point && point <= letters.to,
  );
  return range === undefined ? character : String.fromCodePoint(range.capital + point - range.from);
};

/**
 * Per character, so no final sigma is written; down, up and down again fully folds all but
 * dotless i, Cherokee and what 15.1 lacks.
 */
const foldedCharacter = (character: string): string =>
  character === DOTLESS_I || !knownToUnicode15_1(character)
    ? character
    : Array.from(character.toLowerCase().toUpperCase().toLowerCase(), cherokeeCapitalOf).join("");

/** A folded character is never a space, so the words are found after folding. */
const spacedAs = (identifier: string, written: (character: string) => string): string =>
  Array.from(identifier, (character) => (WHITESPACE.has(character) ? SPACE : written(character)))
    .join("")
    .split(SPACE)
    .filter((word) => word !== "")
    .join(SPACE);

/** Folded as the worker folds, with each run of whitespace one space and none at either end. */
export const normalisedIdentifier = (identifier: string): string =>
  spacedAs(identifier, foldedCharacter);

/** The first floor the identifier falls below, `characters` before `name-words`. */
export const floorNotCleared = (kind: IdentifierKind, identifier: string): Floor | undefined => {
  const normalised = normalisedIdentifier(identifier);
  if (Array.from(normalised).length < SUBJECT_IDENTIFIER_FLOOR) return "characters";
  if (kind === "names" && normalised.split(" ").length < SUBJECT_NAME_WORDS_FLOOR) {
    return "name-words";
  }
  return undefined;
};

export type SoughtIdentifier = {
  readonly normalised: string;

  /**
   * Spaced as the agreement spaces it and never folded: the full-text index lower-cases and
   * keeps ß, so it holds the spelling the request recorded.
   */
  readonly recorded: string;

  readonly anAddress: boolean;
};

/**
 * Skips an identifier below a floor. A spelling repeated among the emails, or among the names and
 * other identifiers, is sought once.
 */
export const soughtIdentifiersOf = (
  set: Readonly<Record<IdentifierKind, readonly string[]>> | null,
): readonly SoughtIdentifier[] => {
  const sought = new Map<string, SoughtIdentifier>();
  for (const kind of SUBJECT_IDENTIFIER_KINDS) {
    const anAddress = kind === EMAILS;
    for (const identifier of set?.[kind] ?? []) {
      if (floorNotCleared(kind, identifier) !== undefined) continue;
      const normalised = normalisedIdentifier(identifier);
      const recorded = spacedAs(identifier, (character) => character);
      sought.set(`${String(anAddress)}:${recorded}`, { normalised, recorded, anAddress });
    }
  }
  return [...sought.values()];
};

/** Offsets count code points, not UTF-16 units; `end` is exclusive. */
export type ErasureMatch = {
  readonly start: number;
  readonly end: number;
};

/**
 * Each folded code unit keeps the text character it came from: ß folds to two, and an
 * occurrence counts the text's own characters.
 */
type Folded = {
  readonly text: string;
  readonly origins: readonly number[];
};

const foldedOf = (characters: readonly string[]): Folded => {
  const pieces: string[] = [];
  const origins: number[] = [];
  characters.forEach((character, at) => {
    if (!WHITESPACE.has(character)) {
      const folded = foldedCharacter(character);
      pieces.push(folded);
      for (let unit = 0; unit < folded.length; unit += 1) origins.push(at);
    } else if (pieces.at(-1) !== SPACE) {
      pieces.push(SPACE);
      origins.push(at);
    }
  });
  return { text: pieces.join(""), origins };
};

/** A match starting or ending between the two letters ß folds to names nothing the text wrote. */
const occurrencesOf = (folded: Folded, normalised: string): readonly ErasureMatch[] => {
  const { text, origins } = folded;
  const found: ErasureMatch[] = [];
  for (let at = text.indexOf(normalised); at !== -1; at = text.indexOf(normalised, at + 1)) {
    const last = at + normalised.length - 1;
    const start = origins[at];
    const end = origins[last];
    const whole = origins[at - 1] !== start && origins[last + 1] !== end;
    if (whole && start !== undefined && end !== undefined) found.push({ start, end: end + 1 });
  }
  return found;
};

const aWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && WORD_CHARACTER.test(character) && knownToUnicode15_1(character);

const carriesOn = (joiner: string | undefined, beyond: string | undefined): boolean =>
  joiner !== undefined && ADDRESS_JOINERS.has(joiner) && aWordCharacter(beyond);

const bounded = (
  characters: readonly string[],
  { start, end }: ErasureMatch,
  anAddress: boolean,
): boolean => {
  const before = characters[start - 1];
  const after = characters[end];
  if (aWordCharacter(before) || aWordCharacter(after)) return false;
  return !(
    anAddress &&
    (carriesOn(before, characters[start - 2]) || carriesOn(after, characters[end + 1]))
  );
};

/** Whole-word matches, each span once, sorted by start and then end. */
export const erasureMatchesIn = (
  text: string,
  sought: readonly SoughtIdentifier[],
): readonly ErasureMatch[] => {
  if (sought.length === 0) return [];
  const characters = Array.from(text);
  const folded = foldedOf(characters);
  const found = new Map<string, ErasureMatch>();
  for (const { normalised, anAddress } of sought) {
    for (const match of occurrencesOf(folded, normalised)) {
      if (bounded(characters, match, anAddress)) found.set(`${match.start}:${match.end}`, match);
    }
  }
  return [...found.values()].sort((one, other) => one.start - other.start || one.end - other.end);
};
