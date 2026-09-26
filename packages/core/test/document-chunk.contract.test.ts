import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ULID } from "@better-answers/schema";

import { chunkIdOf, parseLocator, spanText } from "../src/sources/index.ts";
import { contractFixture, documentChunkRow, OPEN_OUTCOMES } from "./contract-fixture.ts";

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
  chunk_id: z.object({
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
    binding_id: z.string().min(1),
    media_type: z.string().min(1),
    chunk_size: z.int().positive(),
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
    chunks: z.array(documentChunkRow),
  }),
  open: z.array(openCase),
});

const fixture = contractFixture("document-chunk", fixtureSchema);
const { document } = fixture;

describe("the chunk id derived from a document and an ordinal", () => {
  it("derives the id the agreement names for each case", () => {
    for (const { source_document_id, ordinal, id } of fixture.chunk_id.cases) {
      expect({ ordinal, id: chunkIdOf(source_document_id, ordinal) }).toEqual({ ordinal, id });
    }
  });

  it("derives the id each of the document's chunk rows carries", () => {
    for (const row of document.chunks) {
      expect({
        ordinal: row.ordinal,
        id: chunkIdOf(document.source_document_id, row.ordinal),
      }).toEqual({ ordinal: row.ordinal, id: row.id });
    }
  });

  it("pads the ordinal so ids sort in the splitter's order", () => {
    const ids = document.chunks.map((row) => chunkIdOf(document.source_document_id, row.ordinal));

    expect(ids).toEqual(ids.toSorted());
  });

  it("derives ids in the agreed shape, never a minted one", () => {
    const pattern = new RegExp(fixture.chunk_id.pattern);

    for (const { source_document_id, id } of fixture.chunk_id.cases) {
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
      const parsed = parseLocator(wire);

      expect({ wire, read: parsed.ok ? parsed.value : parsed.error }).toEqual({
        wire,
        read: { sourceDocumentId: source_document_id, charStart: char_start, charEnd: char_end },
      });
    }
  });

  it("answers a malformed locator as it answers a withheld passage", () => {
    for (const { wire, why } of fixture.locator.must_not_parse) {
      const parsed = parseLocator(wire);

      expect({ why, refusal: parsed.ok ? "parsed" : parsed.error }).toEqual({
        why,
        refusal: fixture.locator.not_found,
      });
    }
  });

  it("reads each chunk row's locator back to the row's span", () => {
    for (const row of document.chunks) {
      const parsed = parseLocator(row.locator);

      expect({ ordinal: row.ordinal, read: parsed.ok ? parsed.value : parsed.error }).toEqual({
        ordinal: row.ordinal,
        read: {
          sourceDocumentId: document.source_document_id,
          charStart: row.char_start,
          charEnd: row.char_end,
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

  it("is partitioned by its chunk rows", () => {
    let at = 0;
    for (const row of document.chunks) {
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
      const passage = parsed.ok ? spanText(document.normalised_text, parsed.value) : parsed;

      expect({ case: answered.case, passage: passage.ok ? passage.value : passage.error }).toEqual({
        case: answered.case,
        passage: answered.passage,
      });
    }
  });

  it("cuts by code points, where a UTF-16 slice goes wrong", () => {
    const cited = fixture.open.filter(
      (each) => each.expect === "passage" && each.passage !== undefined,
    );

    expect(cited.length).toBeGreaterThan(0);
    for (const answered of cited) {
      const parsed = parseLocator(answered.wire);

      if (!parsed.ok) throw new Error(`the fixture's own locator did not parse: ${answered.wire}`);
      const { charStart, charEnd } = parsed.value;
      if (charStart <= document.astral.at) continue;
      expect({
        case: answered.case,
        byUnit: document.normalised_text.slice(charStart, charEnd),
      }).not.toEqual({ case: answered.case, byUnit: answered.passage });
    }
  });

  it("covers exactly the chunk rows its span overlaps", () => {
    for (const answered of fixture.open.filter((each) => each.covers_ordinals !== undefined)) {
      const parsed = parseLocator(answered.wire);

      if (!parsed.ok) throw new Error(`the fixture's own locator did not parse: ${answered.wire}`);
      const overlapping = document.chunks
        .filter(
          (row) => row.char_start < parsed.value.charEnd && row.char_end > parsed.value.charStart,
        )
        .map((row) => row.ordinal);

      expect({ case: answered.case, rows: overlapping }).toEqual({
        case: answered.case,
        rows: answered.covers_ordinals,
      });
    }
  });

  it("answers not found to a malformed locator before any read", () => {
    const atTheParser = fixture.open.filter((each) => each.refused_by === "the parser");

    expect(atTheParser.length).toBeGreaterThan(0);
    for (const refused of atTheParser) {
      const parsed = parseLocator(refused.wire);

      expect({ case: refused.case, refusal: parsed.ok ? "parsed" : parsed.error }).toEqual({
        case: refused.case,
        refusal: fixture.locator.not_found,
      });
    }
  });

  it("leaves a well-shaped locator for the read to refuse", () => {
    const atTheRead = fixture.open.filter((each) => each.refused_by === "the read");

    expect(atTheRead.length).toBeGreaterThan(0);
    for (const refused of atTheRead) {
      const parsed = parseLocator(refused.wire);

      if (!parsed.ok)
        throw new Error(`the parser refused what the read must refuse: ${refused.case}`);
      const cut = spanText(document.normalised_text, parsed.value);
      const outcome =
        parsed.value.sourceDocumentId === document.source_document_id
          ? cut.ok
            ? "a passage"
            : cut.error
          : "another document";

      expect({ case: refused.case, outcome }).toEqual({
        case: refused.case,
        outcome:
          refused.because === "out of range" ? fixture.locator.not_found : "another document",
      });
    }
  });
});
