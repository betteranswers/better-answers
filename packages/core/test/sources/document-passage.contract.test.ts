import { inspect } from "node:util";

import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { ULID } from "@better-answers/schema";

import { passageIdOf, parseLocator, spanText } from "../../src/sources/index.ts";
import {
  contractFixture,
  documentPassageRow,
  OPEN_OUTCOMES,
} from "../fixtures/contract-fixture.ts";

const REFUSERS = ["the parser", "the read"] as const;

const openCase = z.object({
  case: z.string().min(1),
  wire: z.string(),
  expect: z.enum(OPEN_OUTCOMES),
  passage: z.string().optional(),
  covers_ordinals: z.array(z.int().nonnegative()).optional(),
  refused_by: z.enum(REFUSERS).optional(),
  because: z.string().optional(),
  why: z.string().min(1),
});

const fixtureSchema = z.object({
  description: z.string(),
  passage_id: z.object({
    shape: z.string().min(1),
    separator: z.string().min(1),
    ordinal_digits: z.int().positive(),
    pattern: z.string().min(1),
    cases: z.array(
      z.object({
        source_document_id: z.string().min(1),
        ordinal: z.int().nonnegative(),
        id: z.string().min(1),
        why: z.string().min(1),
      }),
    ),
  }),
  locator: z.object({
    shape: z.string().min(1),
    offsets: z.string().min(1),
    not_found: z.string().min(1),
    must_parse: z.array(
      z.object({
        wire: z.string().min(1),
        source_document_id: z.string().min(1),
        char_start: z.int().nonnegative(),
        char_end: z.int().nonnegative(),
        why: z.string().min(1),
      }),
    ),
    must_not_parse: z.array(z.object({ wire: z.string(), why: z.string().min(1) })),
  }),
  document: z.object({
    source_document_id: z.string().min(1),
    connected_source_id: z.string().min(1),
    media_type: z.string().min(1),
    passage_size: z.int().positive(),
    normalised_text: z.string().min(1),
    code_points: z.int().positive(),
    utf16_units: z.int().positive(),
    astral: z.object({
      character: z.string().min(1),
      code_point: z.string().min(1),
      at: z.int().nonnegative(),
      utf16_units: z.int().positive(),
      why: z.string().min(1),
    }),
    passages: z.array(documentPassageRow),
  }),
  open: z.array(openCase),
});

const fixture = contractFixture("document-passage", fixtureSchema);
const { document } = fixture;

const spanOf = (wire: string) => {
  const parsed = parseLocator(wire);
  if (!parsed.ok) throw new Error(`the fixture's own locator did not parse: ${wire}`);
  return parsed.value;
};

const ordinalsOverlapping = (span: { charStart: number; charEnd: number }): number[] =>
  document.passages
    .filter((row) => row.char_start < span.charEnd && row.char_end > span.charStart)
    .map((row) => row.ordinal);

const CITED_PAST_THE_ASTRAL = fixture.open.filter(
  (each) =>
    each.expect === "passage" &&
    each.passage !== undefined &&
    spanOf(each.wire).charStart > document.astral.at,
);

const AT_THE_READ = fixture.open.filter((each) => each.refused_by === "the read");
const OUT_OF_RANGE = AT_THE_READ.filter((each) => each.because === "out of range");
const IN_ANOTHER_DOCUMENT = AT_THE_READ.filter((each) => each.because !== "out of range");

describe("the passage id derived from a document and an ordinal", () => {
  it("derives the id the agreement names for each case", () => {
    for (const { source_document_id, ordinal, id } of fixture.passage_id.cases) {
      expect({ ordinal, id: passageIdOf(source_document_id, ordinal) }).toEqual({ ordinal, id });
    }
  });

  it("derives the id each of the document's passage rows carries", () => {
    for (const row of document.passages) {
      expect({
        ordinal: row.ordinal,
        id: passageIdOf(document.source_document_id, row.ordinal),
      }).toEqual({ ordinal: row.ordinal, id: row.id });
    }
  });

  it("pads the ordinal so ids sort in the splitter's order", () => {
    const ids = document.passages.map((row) =>
      passageIdOf(document.source_document_id, row.ordinal),
    );

    expect(ids).toEqual(ids.toSorted());
  });

  it("derives ids in the agreed shape, never a minted one", () => {
    const pattern = new RegExp(fixture.passage_id.pattern);

    for (const { source_document_id, id } of fixture.passage_id.cases) {
      expect({ id, shaped: pattern.test(id), minted: ULID.test(id) }).toEqual({
        id,
        shaped: true,
        minted: false,
      });
      expect({ id, document: ULID.test(source_document_id) }).toEqual({ id, document: true });
    }
  });
});

describe("the wire locator", () => {
  it("reads the document and span from every locator that parses", () => {
    for (const { wire, source_document_id, char_start, char_end } of fixture.locator.must_parse) {
      expect({ wire, read: parseLocator(wire) }).toEqual({
        wire,
        read: {
          ok: true,
          value: { sourceDocumentId: source_document_id, charStart: char_start, charEnd: char_end },
        },
      });
    }
  });

  it("answers a malformed locator as it answers a withheld passage", () => {
    for (const { wire, why } of fixture.locator.must_not_parse) {
      expect({ why, refusal: parseLocator(wire) }).toEqual({
        why,
        refusal: { ok: false, error: fixture.locator.not_found },
      });
    }
  });

  it("reads each passage row's locator back to the row's span", () => {
    for (const row of document.passages) {
      expect({ ordinal: row.ordinal, read: parseLocator(row.locator) }).toEqual({
        ordinal: row.ordinal,
        read: {
          ok: true,
          value: {
            sourceDocumentId: document.source_document_id,
            charStart: row.char_start,
            charEnd: row.char_end,
          },
        },
      });
    }
  });
});

describe("the normalised text the offsets are counted in", () => {
  it("is longer in UTF-16 units than in code points", () => {
    expect({
      codePoints: Array.from(document.normalised_text).length,
      utf16Units: document.normalised_text.length,
    }).toEqual({ codePoints: document.code_points, utf16Units: document.utf16_units });
    expect(document.utf16_units).toBeGreaterThan(document.code_points);
  });

  it("carries the named astral character at the named code point", () => {
    expect(Array.from(document.normalised_text)[document.astral.at]).toBe(
      document.astral.character,
    );
    expect(document.astral.character.length).toBe(document.astral.utf16_units);
  });

  it("is partitioned by its passage rows", () => {
    let at = 0;
    for (const row of document.passages) {
      expect({ ordinal: row.ordinal, start: row.char_start }).toEqual({
        ordinal: row.ordinal,
        start: at,
      });
      expect(
        Array.from(document.normalised_text).slice(row.char_start, row.char_end).join(""),
      ).toBe(row.content);
      at = row.char_end;
    }
    expect(at).toBe(document.code_points);
  });
});

describe("the passage a locator opens", () => {
  it("cuts the agreed passage from the text for each locator", () => {
    for (const answered of fixture.open.filter((each) => each.expect === "passage")) {
      const parsed = parseLocator(answered.wire);
      assert(parsed.ok, `${answered.case}: ${inspect(parsed)}`);

      expect({
        case: answered.case,
        passage: spanText(document.normalised_text, parsed.value),
      }).toEqual({
        case: answered.case,
        passage: { ok: true, value: answered.passage },
      });
    }
  });

  it("cuts by code points, where a UTF-16 slice goes wrong", () => {
    expect(CITED_PAST_THE_ASTRAL.length).toBeGreaterThan(0);
    for (const answered of CITED_PAST_THE_ASTRAL) {
      const { charStart, charEnd } = spanOf(answered.wire);
      expect({
        case: answered.case,
        byUnit: document.normalised_text.slice(charStart, charEnd),
      }).not.toEqual({ case: answered.case, byUnit: answered.passage });
    }
  });

  it("covers exactly the passage rows its span overlaps", () => {
    for (const answered of fixture.open.filter((each) => each.covers_ordinals !== undefined)) {
      expect({ case: answered.case, rows: ordinalsOverlapping(spanOf(answered.wire)) }).toEqual({
        case: answered.case,
        rows: answered.covers_ordinals,
      });
    }
  });

  it("answers not found to a malformed locator before any read", () => {
    const atTheParser = fixture.open.filter((each) => each.refused_by === "the parser");

    expect(atTheParser.length).toBeGreaterThan(0);
    for (const refused of atTheParser) {
      expect({ case: refused.case, refusal: parseLocator(refused.wire) }).toEqual({
        case: refused.case,
        refusal: { ok: false, error: fixture.locator.not_found },
      });
    }
  });

  it("leaves a well-shaped locator for the read to refuse", () => {
    expect(OUT_OF_RANGE.length).toBeGreaterThan(0);
    expect(IN_ANOTHER_DOCUMENT.length).toBeGreaterThan(0);
    for (const refused of OUT_OF_RANGE) {
      const span = spanOf(refused.wire);

      expect({
        case: refused.case,
        document: span.sourceDocumentId,
        cut: spanText(document.normalised_text, span),
      }).toEqual({
        case: refused.case,
        document: document.source_document_id,
        cut: { ok: false, error: fixture.locator.not_found },
      });
    }
    for (const refused of IN_ANOTHER_DOCUMENT) {
      expect({ case: refused.case, document: spanOf(refused.wire).sourceDocumentId }).not.toEqual({
        case: refused.case,
        document: document.source_document_id,
      });
    }
  });
});
