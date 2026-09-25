import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SUBJECT_IDENTIFIER_FLOOR,
  SUBJECT_IDENTIFIER_KINDS,
  SUBJECT_NAME_WORDS_FLOOR,
} from "@better-answers/schema";

import {
  erasureMatchesIn,
  floorNotCleared,
  normalisedIdentifier,
  soughtIdentifiersOf,
} from "../src/erasure/index.ts";
import { contractFixture } from "./contract-fixture.ts";

const fixtureSchema = z.object({
  description: z.string(),
  offsets: z.string().min(1),
  floor: z.object({
    characters: z.int().positive(),
    name_words: z.int().positive(),
    rule: z.string().min(1),
  }),
  normalisation: z.object({
    rule: z.string().min(1),
    whitespace: z.array(z.string().length(1)).min(1),
    cases: z
      .array(z.object({ identifier: z.string(), normalised: z.string(), why: z.string().min(1) }))
      .min(1),
  }),
  boundary: z.object({
    rule: z.string().min(1),
    word_categories: z.array(z.string().length(1)).min(1),
    address_joiners: z.array(z.string().length(1)).min(1),
  }),
  digests: z.object({
    rule: z.string().min(1),
    folding: z.object({ lines: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    word_characters: z.object({
      lines: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  }),
  cases: z
    .array(
      z.object({
        kind: z.enum(SUBJECT_IDENTIFIER_KINDS),
        identifier: z.string().min(1),
        text: z.string().min(1),
        clears_the_floor: z.boolean(),
        occurrences: z.array(
          z.object({
            start: z.int().nonnegative(),
            end: z.int().positive(),
            reads: z.string().min(1),
          }),
        ),
        why: z.string().min(1),
      }),
    )
    .min(1),
});

const fixture = contractFixture("erasure-match", fixtureSchema);

const LAST_CODE_POINT = 0x10ffff;
const SURROGATES = { from: 0xd800, to: 0xdfff };

const everyCharacter = function* (): Generator<string> {
  for (let point = 0; point <= LAST_CODE_POINT; point += 1) {
    if (point < SURROGATES.from || point > SURROGATES.to) yield String.fromCodePoint(point);
  }
};

describe("an identifier as the erasure-match agreement normalises it", () => {
  it("is normalised as every case of the agreement answers", () => {
    for (const { identifier, normalised, why } of fixture.normalisation.cases) {
      expect({ why, normalised: normalisedIdentifier(identifier) }).toEqual({ why, normalised });
    }
  });

  it("treats as whitespace exactly the code points the agreement lists", () => {
    const spaced = [...everyCharacter()].filter(
      (character) => normalisedIdentifier(`a${character}b`) === "a b",
    );

    expect(spaced.toSorted()).toEqual(fixture.normalisation.whitespace.toSorted());
  });
});

const WHITESPACE = new Set(fixture.normalisation.whitespace);

const charactersTheDigestsRead = function* (): Generator<string> {
  for (const character of everyCharacter()) {
    if (!WHITESPACE.has(character)) yield character;
  }
};

const digestOf = (lines: Iterable<string>): string =>
  createHash("sha256")
    .update([...lines].join(""), "utf8")
    .digest("hex");

const hexOf = (text: string): string =>
  Array.from(text, (character) =>
    (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0"),
  ).join(" ");

const matchesOf = (kind: (typeof SUBJECT_IDENTIFIER_KINDS)[number], identifier: string) => {
  const sought = soughtIdentifiersOf({ emails: [], names: [], other: [], [kind]: [identifier] });
  return (text: string) => erasureMatchesIn(text, sought);
};

let theWordCharacters: ReadonlySet<string> | undefined;

/** Read once for the two tests that need it: a walk of every code point takes seconds. */
const wordCharacters = (): ReadonlySet<string> => {
  if (theWordCharacters !== undefined) return theWordCharacters;
  const ofABC = matchesOf("other", "abc");
  theWordCharacters = new Set(
    [...charactersTheDigestsRead()].filter((character) => ofABC(`abc${character}`).length === 0),
  );
  return theWordCharacters;
};

describe("an occurrence as the erasure-match agreement answers it", () => {
  it("is found exactly where each agreement case names, nowhere else", () => {
    for (const { kind, identifier, text, occurrences, why } of fixture.cases) {
      const characters = Array.from(text);
      const matches = matchesOf(kind, identifier)(text);
      const found = matches.map(({ start, end }) => ({
        start,
        end,
        reads: characters.slice(start, end).join(""),
      }));

      expect({ why, found }).toEqual({ why, found: occurrences });
    }
  });

  it("folds each code point as the agreement's Unicode 15.1 digest", () => {
    const lines = function* () {
      for (const character of charactersTheDigestsRead()) {
        const folded = normalisedIdentifier(character);
        if (folded !== character) yield `${hexOf(character)} ${hexOf(folded)}\n`;
      }
    };

    expect(digestOf(lines())).toBe(fixture.digests.folding.sha256);
  });

  it("is unbounded by exactly the word characters the digest names", () => {
    const lines = [...wordCharacters()].map((character) => `${hexOf(character)}\n`);

    expect(digestOf(lines)).toBe(fixture.digests.word_characters.sha256);
  });

  it("is unbounded for an address by exactly the listed joiners", () => {
    const ofTheAddress = matchesOf("emails", "ab@cd.ef");
    const words = wordCharacters();
    const joiners = [...charactersTheDigestsRead()].filter(
      (character) => !words.has(character) && ofTheAddress(`ab@cd.ef${character}g`).length === 0,
    );

    expect(joiners.toSorted()).toEqual(fixture.boundary.address_joiners.toSorted());
  });
});

describe("the floor the erasure-match agreement states", () => {
  it("is the one the schema states beside the identifier limits", () => {
    expect({
      characters: SUBJECT_IDENTIFIER_FLOOR,
      nameWords: SUBJECT_NAME_WORDS_FLOOR,
    }).toEqual({ characters: fixture.floor.characters, nameWords: fixture.floor.name_words });
  });

  it("is cleared by exactly the identifiers the agreement names", () => {
    for (const { kind, identifier, clears_the_floor: clears, why } of fixture.cases) {
      expect({ why, clears: floorNotCleared(kind, identifier) === undefined }).toEqual({
        why,
        clears,
      });
    }
  });
});
