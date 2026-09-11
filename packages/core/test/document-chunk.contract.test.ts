import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ULID } from "@better-answers/schema";

import { chunkIdOf, parseLocator, spanText } from "../src/sources/index.ts";
import { contractFixture } from "./contract-fixture.ts";

/**
 * The document-chunk agreement's TypeScript half (ADR 0031, ADR 0036): the fixture in
 * `contracts/document-chunk/` is the contract — a normalised text and a binding's fields in,
 * the chunk rows out, and the passage a locator opens — and this suite holds this tier's two
 * pure helpers to it. The Python half is `apps/worker/tests/test_document_chunk_contract.py`,
 * where the same file is read by the tier that produces the rows.
 *
 * **Why this agreement exists at all.** The two tiers index a string differently: Python by
 * code point, JavaScript by UTF-16 unit. A locator's offsets are code points (`CONTEXT.md`,
 * *locator*), so the fixture's text carries an astral character before a cited span and both
 * tiers are held to one answer for it. A test that only asserted an offset against itself
 * would pass on both sides and still let a passage come back one character out.
 *
 * What this tier can hold today is the address arithmetic: the derived chunk id, the wire
 * locator's parse and the span cut out of the text. The splitter that produces the rows is
 * the worker's (T-129) and `passageAt`, which cuts the same span out of the covering rows
 * under the read predicate, is T-133's; both are held to this same file when they land.
 *
 * Neither half holds the other's literals (`[TEST9]`): each expected value is the fixture's
 * own, and each tier asserts against its own code.
 */

const chunkRow = z.object({
  ordinal: z.int().nonnegative(),
  id: z.string().min(1),
  char_start: z.int().nonnegative(),
  char_end: z.int().nonnegative(),
  locator: z.string().min(1),
  content: z.string().min(1),
});

const openCase = z.object({
  case: z.string().min(1),
  wire: z.string(),
  expect: z.enum(["passage", "not-found"]),
  passage: z.string().optional(),
  covers_ordinals: z.array(z.int().nonnegative()).optional(),
  refused_by: z.enum(["the parser", "the read"]).optional(),
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
    chunks: z.array(chunkRow),
  }),
  open: z.array(openCase),
});

const fixture = contractFixture("document-chunk", fixtureSchema);
const { document } = fixture;

describe("the chunk id the fixture derives from a document and an ordinal", () => {
  it("derives the id the agreement names, for every document and ordinal it names one for", () => {
    for (const { source_document_id, ordinal, id } of fixture.chunk_id.cases) {
      expect({ ordinal, id: chunkIdOf(source_document_id, ordinal) }).toEqual({ ordinal, id });
    }
  });

  it("derives the id every chunk row of the fixture's document already carries", () => {
    for (const row of document.chunks) {
      expect({
        ordinal: row.ordinal,
        id: chunkIdOf(document.source_document_id, row.ordinal),
      }).toEqual({ ordinal: row.ordinal, id: row.id });
    }
  });

  it("pads the ordinal so a document's chunks sort by it as text, in the order the splitter cut them", () => {
    const ids = document.chunks.map((row) => chunkIdOf(document.source_document_id, row.ordinal));

    expect(ids).toEqual(ids.toSorted());
  });

  it("derives an id in the fixture's shape, and never one this tier would take for a minted id", () => {
    const pattern = new RegExp(fixture.chunk_id.pattern);

    for (const { source_document_id, id } of fixture.chunk_id.cases) {
      // A chunk id is computed from an address (ADR 0036's stable id) and never minted, so
      // the shape the platform mints must refuse it — while the document half it is built
      // from is exactly that shape. Confusing the two would let a row key stand where an
      // id belongs, which is what the id-shape agreement exists to stop.
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
  it("reads the document and the span out of every locator the agreement says parses", () => {
    for (const { wire, source_document_id, char_start, char_end } of fixture.locator.must_parse) {
      const parsed = parseLocator(wire);

      expect({ wire, read: parsed.ok ? parsed.value : parsed.error }).toEqual({
        wire,
        read: { sourceDocumentId: source_document_id, charStart: char_start, charEnd: char_end },
      });
    }
  });

  it("refuses every malformed locator with the one word a withheld passage answers to", () => {
    for (const { wire, why } of fixture.locator.must_not_parse) {
      const parsed = parseLocator(wire);

      expect({ why, refusal: parsed.ok ? "parsed" : parsed.error }).toEqual({
        why,
        refusal: fixture.locator.not_found,
      });
    }
  });

  it("reads a chunk row's own locator back to the span that row carries in two columns", () => {
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
  it("is longer in UTF-16 units than in code points, which is the whole reason this file exists", () => {
    expect({
      codePoints: Array.from(document.normalised_text).length,
      utf16Units: document.normalised_text.length,
    }).toEqual({ codePoints: document.code_points, utf16Units: document.utf16_units });
    expect(document.utf16_units).toBeGreaterThan(document.code_points);
  });

  it("carries the astral character the agreement names, at the code point it names", () => {
    expect(Array.from(document.normalised_text)[document.astral.at]).toBe(
      document.astral.character,
    );
    expect(document.astral.character.length).toBe(document.astral.utf16_units);
  });

  it("is partitioned by its chunk rows, so a span straddling two of them has one answer", () => {
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
  it("cuts the span the agreement names out of the text, for every locator it answers a passage to", () => {
    for (const answered of fixture.open.filter((each) => each.expect === "passage")) {
      const parsed = parseLocator(answered.wire);
      const passage = parsed.ok ? spanText(document.normalised_text, parsed.value) : parsed;

      expect({ case: answered.case, passage: passage.ok ? passage.value : passage.error }).toEqual({
        case: answered.case,
        passage: answered.passage,
      });
    }
  });

  it("cuts by code points, where this tier's own slice would take the wrong characters", () => {
    // The one assertion the astral character is in the fixture for. `String.prototype.slice`
    // counts UTF-16 units, so every span after the astral character is a unit out — the
    // passage starts one character early and ends one character short. Nothing in this suite
    // is allowed to pass by accident of both sides making the same mistake.
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

  it("names the rows a passage is cut from, and they are the rows whose spans it overlaps", () => {
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

  it("answers not found to a malformed locator at the parser, before anything is read", () => {
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

  it("leaves a well-shaped locator for the read to refuse, and never guesses at the parser", () => {
    // A span past the end of the text and a document this workspace does not hold are both
    // well-formed addresses. A parser that refused them would be answering a question it has
    // neither the text nor the rows to answer; the read answers both with the same word.
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
