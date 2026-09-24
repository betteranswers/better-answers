import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SUBJECT_IDENTIFIER_FLOOR,
  SUBJECT_IDENTIFIER_KINDS,
  SUBJECT_NAME_WORDS_FLOOR,
} from "@better-answers/schema";

import { floorNotCleared, normalisedIdentifier } from "../src/erasure/index.ts";
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

describe("an identifier as the erasure-match agreement normalises it", () => {
  it("is normalised as every case of the agreement answers", () => {
    for (const { identifier, normalised, why } of fixture.normalisation.cases) {
      expect({ why, normalised: normalisedIdentifier(identifier) }).toEqual({ why, normalised });
    }
  });

  it("treats as whitespace every code point the agreement lists and no other", () => {
    const spaced: string[] = [];
    for (let point = 0; point <= LAST_CODE_POINT; point += 1) {
      if (point >= SURROGATES.from && point <= SURROGATES.to) continue;
      const character = String.fromCodePoint(point);
      if (normalisedIdentifier(`a${character}b`) === "a b") spaced.push(character);
    }

    expect(spaced.toSorted()).toEqual(fixture.normalisation.whitespace.toSorted());
  });
});

describe("the floor the erasure-match agreement states", () => {
  it("is the one the schema states beside the identifier limits", () => {
    expect({
      characters: SUBJECT_IDENTIFIER_FLOOR,
      nameWords: SUBJECT_NAME_WORDS_FLOOR,
    }).toEqual({ characters: fixture.floor.characters, nameWords: fixture.floor.name_words });
  });

  it("is cleared by every identifier the agreement says clears it, and by no other", () => {
    for (const { kind, identifier, clears_the_floor: clears, why } of fixture.cases) {
      expect({ why, clears: floorNotCleared(kind, identifier) === undefined }).toEqual({
        why,
        clears,
      });
    }
  });
});
