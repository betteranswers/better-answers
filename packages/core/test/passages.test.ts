import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ulid } from "@better-answers/schema";

import { passageAt } from "../src/sources/index.ts";
import { contractFixture } from "./contract-fixture.ts";
import { seededBy, visibilitySuite } from "./sourced-concept.ts";

/**
 * The passage a locator opens, over real chunk rows (`[TEST2]`, `[TEST4]`): `passageAt`
 * resolves a wire locator to the rows of `index.chunk` covering its span, under the read
 * predicate applied once in the same statement, and cuts the span's text out of them.
 *
 * The agreement it is held to is `contracts/document-chunk/cases.json` (ADR 0031), whose
 * pure half — the derived id, the locator's parse, the span cut out of a text — is
 * `document-chunk.contract.test.ts`. Here the same document's three rows are **seeded** and
 * the same six `open` cases are asked of the read, because the two halves of the agreement
 * can only disagree where a row stands between them: a tier that counted UTF-16 units would
 * cut a passage one character early and one short, and the fixture's astral character is
 * what makes that visible.
 *
 * Every expected passage is a literal (`[TEST9]`) — the agreement's own, written down in
 * `cases.json`, never the fixture's text sliced here to produce the value it is compared to.
 *
 * The refusals are one word. A locator the parser will not read, a span past the end of the
 * text, a document this workspace does not hold and a row this reader may not see all answer
 * *not found*, and the pair both ways (`[TEST7]`) is the Admin who does see the withheld row
 * getting the passage from the same locator.
 */

const fixtureSchema = z.object({
  locator: z.object({ not_found: z.string().min(1) }),
  document: z.object({
    source_document_id: z.string().min(1),
    binding_id: z.string().min(1),
    chunks: z.array(
      z.object({
        ordinal: z.int().nonnegative(),
        id: z.string().min(1),
        char_start: z.int().nonnegative(),
        char_end: z.int().nonnegative(),
        locator: z.string().min(1),
        content: z.string().min(1),
      }),
    ),
  }),
  open: z.array(
    z.object({
      case: z.string().min(1),
      wire: z.string().min(1),
      expect: z.enum(["passage", "not-found"]),
      passage: z.string().optional(),
    }),
  ),
});

const fixture = contractFixture("document-chunk", fixtureSchema);
const { document } = fixture;
const NOT_FOUND = fixture.locator.not_found;

const { db, arrange, reading } = visibilitySuite();

/** A literal the test writes down (`[TEST9]`): a published instant, never the wall clock. */
const PUBLISHED = new Date("2026-09-11T09:00:00.000Z");

/** The title the agreement's document is catalogued under, which a passage is served with. */
const INVOICE_TITLE = "The bid library's invoice";

/**
 * The agreement's document and its three chunk rows, as a run would have landed them: the
 * binding and the document carry the fixture's own ids, and every row names all five address
 * columns, because `seed.chunk` leaves them NULL for the suites that want the visibility
 * columns alone.
 */
const seedTheAgreementsDocument = (workspaceId: string): Promise<void> =>
  seededBy(db(), async (seed) => {
    const binding = await seed.sourceBinding({
      workspaceId,
      id: document.binding_id,
      publishedAt: PUBLISHED,
      sensitivity: "Internal",
    });
    await seed.sourceDocument({
      workspaceId,
      bindingId: binding.id,
      id: document.source_document_id,
      title: INVOICE_TITLE,
    });
    for (const row of document.chunks) {
      await seed.chunk({
        workspaceId,
        bindingId: binding.id,
        sourceDocumentId: document.source_document_id,
        id: row.id,
        ordinal: row.ordinal,
        charStart: row.char_start,
        charEnd: row.char_end,
        locator: row.locator,
        content: row.content,
        publishedAt: PUBLISHED,
        sensitivity: "Internal",
      });
    }
  });

/** One document of this workspace whose whole text is a single chunk row; its id. */
const documentWithOneChunk = (
  workspaceId: string,
  what: {
    readonly title: string;
    readonly text: string;
    readonly charEnd: number;
    readonly sensitivity: string;
  },
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const binding = await seed.sourceBinding({
      workspaceId,
      publishedAt: PUBLISHED,
      sensitivity: what.sensitivity,
    });
    const held = await seed.sourceDocument({
      workspaceId,
      bindingId: binding.id,
      title: what.title,
    });
    await seed.chunk({
      workspaceId,
      bindingId: binding.id,
      sourceDocumentId: held.id,
      content: what.text,
      locator: `${held.id}/chars:0-${what.charEnd}`,
      ordinal: 0,
      charStart: 0,
      charEnd: what.charEnd,
      publishedAt: PUBLISHED,
      sensitivity: what.sensitivity,
    });
    return held.id;
  });

const BOARD_TITLE = "The board's note";
const BOARD_TEXT = "The board's note on the bid.";
const BOARD_CHAR_END = 28;

describe("the passage a wire locator opens", () => {
  it("answers every case the document-chunk agreement states, the astral character included", async () => {
    const scenario = await arrange();
    await seedTheAgreementsDocument(scenario.workspaceId);

    const answered = [];
    for (const opened of fixture.open) {
      const read = await reading(scenario.viewer, (viewer, tx) =>
        passageAt(viewer, tx, opened.wire),
      );
      answered.push({ case: opened.case, answer: read.ok ? read.value : read.error });
    }

    expect(answered).toEqual(
      fixture.open.map((opened) => ({
        case: opened.case,
        answer:
          opened.expect === "passage"
            ? {
                locator: opened.wire,
                title: INVOICE_TITLE,
                text: opened.passage,
                sensitivity: "Internal",
              }
            : NOT_FOUND,
      })),
    );
  });

  it("answers a span running from one chunk row into the next as one passage, at the narrower of their classes", async () => {
    const scenario = await arrange();
    // Two rows partitioning one text, the second narrowed on its own row: a straddle has to
    // join the rows' content in ordinal order, offset the span by the first row's start, and
    // answer the narrower class of the rows it actually read.
    const documentId = await seededBy(db(), async (seed) => {
      const binding = await seed.sourceBinding({
        workspaceId: scenario.workspaceId,
        publishedAt: PUBLISHED,
      });
      const held = await seed.sourceDocument({
        workspaceId: scenario.workspaceId,
        bindingId: binding.id,
        title: "The staff handbook",
      });
      await seed.chunk({
        workspaceId: scenario.workspaceId,
        bindingId: binding.id,
        sourceDocumentId: held.id,
        content: "The holiday policy ",
        locator: `${held.id}/chars:0-19`,
        ordinal: 0,
        charStart: 0,
        charEnd: 19,
        publishedAt: PUBLISHED,
        sensitivity: "Internal",
      });
      await seed.chunk({
        workspaceId: scenario.workspaceId,
        bindingId: binding.id,
        sourceDocumentId: held.id,
        content: "grants twenty-eight days.",
        locator: `${held.id}/chars:19-44`,
        ordinal: 1,
        charStart: 19,
        charEnd: 44,
        publishedAt: PUBLISHED,
        sensitivity: "Restricted",
      });
      return held.id;
    });
    const wire = `${documentId}/chars:4-43`;

    const read = await reading(scenario.admin, (admin, tx) => passageAt(admin, tx, wire));

    expect(read.ok ? read.value : read.error).toEqual({
      locator: wire,
      title: "The staff handbook",
      text: "holiday policy grants twenty-eight days",
      sensitivity: "Restricted",
    });
  });

  it("carries the locator the agreement writes on the row and the one composed from that row's own columns alike", async () => {
    const scenario = await arrange();
    await seedTheAgreementsDocument(scenario.workspaceId);

    const rows = await reading(scenario.admin, async (admin, tx) => {
      const read = await tx.query<{
        source_document_id: string;
        char_start: number;
        char_end: number;
        locator: string;
      }>(
        `SELECT source_document_id, char_start, char_end, locator FROM "index".chunk
          WHERE workspace_id = $1 AND source_document_id = $2 ORDER BY ordinal`,
        [admin.workspaceId, document.source_document_id],
      );
      return read.rows;
    });

    // The stored word and the derived one are one address or they are two (ADR 0031): a read
    // that composes a hit's locator from three columns and a row that carries a fourth would
    // drift apart silently, and this is the assertion that will not let them.
    expect(rows.length).toBe(document.chunks.length);
    expect(rows.map((row) => row.locator)).toEqual(
      rows.map((row) => `${row.source_document_id}/chars:${row.char_start}-${row.char_end}`),
    );
  });
});

describe("what a passage read refuses", () => {
  it("answers a withheld locator and an absent one alike, and a malformed one and an out-of-range one the same", async () => {
    const scenario = await arrange();
    await seedTheAgreementsDocument(scenario.workspaceId);
    const board = await documentWithOneChunk(scenario.workspaceId, {
      title: BOARD_TITLE,
      text: BOARD_TEXT,
      charEnd: BOARD_CHAR_END,
      sensitivity: "Restricted",
    });

    const wires = {
      withheld: `${board}/chars:0-${BOARD_CHAR_END}`,
      absent: `${ulid()}/chars:0-5`,
      malformed: `${document.source_document_id}/chunks:0-1`,
      "out of range": `${document.source_document_id}/chars:150-200`,
    };
    const answered: Record<string, unknown> = {};
    for (const [what, wire] of Object.entries(wires)) {
      const read = await reading(scenario.viewer, (viewer, tx) => passageAt(viewer, tx, wire));
      answered[what] = read.ok ? read.value : read.error;
    }

    // One word for all four, so a reader learns nothing from the difference between a locator
    // that is wrong, a passage that is not there and a passage they may not see.
    expect(answered).toEqual({
      withheld: NOT_FOUND,
      absent: NOT_FOUND,
      malformed: NOT_FOUND,
      "out of range": NOT_FOUND,
    });
  });

  it("hands the same locator to an Admin the Restricted row reaches, so the Viewer's refusal is the predicate and not an absence", async () => {
    const scenario = await arrange();
    const board = await documentWithOneChunk(scenario.workspaceId, {
      title: BOARD_TITLE,
      text: BOARD_TEXT,
      charEnd: BOARD_CHAR_END,
      sensitivity: "Restricted",
    });
    const wire = `${board}/chars:0-${BOARD_CHAR_END}`;

    const read = await reading(scenario.admin, (admin, tx) => passageAt(admin, tx, wire));

    expect(read.ok ? read.value : read.error).toEqual({
      locator: wire,
      title: BOARD_TITLE,
      text: "The board's note on the bid.",
      sensitivity: "Restricted",
    });
  });
});
