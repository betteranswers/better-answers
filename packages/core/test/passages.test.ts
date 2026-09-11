import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ulid } from "@better-answers/schema";

import type { UserPrincipal } from "../src/kernel/index.ts";
import { findPassages, passageAt, type PassageHit } from "../src/sources/index.ts";
import { contractFixture } from "./contract-fixture.ts";
import {
  bindingHolding,
  conceptCiting,
  groupNamed,
  seededBy,
  visibilitySuite,
} from "./sourced-concept.ts";

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
 *
 * Beside it, `findPassages`: the search over the same rows, whose own pair both ways is the
 * document a concept cites — withheld from the reader who may see that concept, because a
 * document stands alone only when nothing covering it does (ADR 0016), and handed to the
 * reader who may not. The answer is a list and only a list: no total, no count and nothing
 * else a reader could learn the shape of the workspace from.
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

/**
 * One document of this workspace whose whole text is a single chunk row; its id.
 *
 * The binding and its chunk copy carry the same three visibility columns, which is what a run
 * lands (ADR 0023): a search reads the chunk's copy and never the binding's row, so a suite
 * that set the two apart would be proving something no writer can produce.
 */
const documentWithOneChunk = (
  workspaceId: string,
  what: {
    readonly title: string;
    readonly text: string;
    readonly charEnd: number;
    readonly sensitivity: string;
    /** The groups the binding is for; absent is *everyone*, which is what most rows carry. */
    readonly audienceGroups?: readonly string[];
    /** When the binding was published; `null` is a binding still under review. */
    readonly publishedAt?: Date | null;
  },
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const audience =
      what.audienceGroups === undefined
        ? { audience: "everyone", audienceGroups: null }
        : { audience: "groups", audienceGroups: [...what.audienceGroups] };
    const publishedAt = what.publishedAt === undefined ? PUBLISHED : what.publishedAt;
    const binding = await seed.sourceBinding({
      workspaceId,
      publishedAt,
      sensitivity: what.sensitivity,
      ...audience,
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
      publishedAt,
      sensitivity: what.sensitivity,
      ...audience,
    });
    return held.id;
  });

const BOARD_TITLE = "The board's note";
const BOARD_TEXT = "The board's note on the bid.";
const BOARD_CHAR_END = 28;

/**
 * What a search is asked, in the words a person would type. Two bare words with a space
 * between them is prose, not a tsquery: `to_tsquery` raises a syntax error on it, which is
 * why the read parses a caller's words with `websearch_to_tsquery` and this suite asks with
 * words that would have broken the other one.
 */
const QUERY = "holiday policy";

/** The documents a search runs over, each one chunk: the text and the span it occupies. */
const HANDBOOK = {
  title: "The staff handbook",
  text: "The holiday policy grants twenty-eight days.",
  charEnd: 44,
} as const;
const MANUAL = {
  title: "The office manual",
  text: "The holiday policy is the holiday policy the board approved.",
  charEnd: 60,
} as const;
const MINUTES = {
  title: "The board's minutes",
  text: "The board met and the holiday policy was approved.",
  charEnd: 50,
} as const;
const DRAFT = {
  title: "The draft handbook",
  text: "The draft holiday policy nobody has published.",
  charEnd: 46,
} as const;

/** One hit as the read hands it over, from the document it names and the text it landed as. */
const hitOn = (
  documentId: string,
  what: { readonly title: string; readonly charEnd: number },
  sensitivity = "Internal",
) => ({
  sourceDocumentId: documentId,
  title: what.title,
  locator: `${documentId}/chars:0-${what.charEnd}`,
  sensitivity,
});

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

/** The hits a search hands this person, or the error it refused with. */
const searching = (person: UserPrincipal, limit = 10): Promise<readonly PassageHit[] | Error> =>
  reading(person, async (reader, tx) => {
    const found = await findPassages(reader, tx, QUERY, limit);
    return found.ok ? found.value : found.error;
  });

describe("the passages a search finds", () => {
  it("withholds a document from the reader who may see a concept citing it and hands it to the reader who may not", async () => {
    const scenario = await arrange();
    const handbook = await documentWithOneChunk(scenario.workspaceId, {
      ...HANDBOOK,
      sensitivity: "Internal",
    });
    const manual = await documentWithOneChunk(scenario.workspaceId, {
      ...MANUAL,
      sensitivity: "Internal",
    });
    // The concept rests on the handbook and on a Restricted binding's document, so it derives
    // the narrower of the two classes (ADR 0023) and stands Restricted: the Admin may see it,
    // the Viewer may not. Both may see the handbook's chunk, which is what makes this a pair.
    const boardroom = await bindingHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    await conceptCiting(scenario, scenario.editor, [handbook, boardroom.documentId]);

    const viewer = await searching(scenario.viewer);
    const admin = await searching(scenario.admin);

    // A document stands alone only when no concept this reader may see covers it (ADR 0016).
    // The Admin, who may see the concept, is offered the concept instead; the Viewer, for whom
    // the concept is not there at all, is offered the document. The same row, two answers, and
    // the difference is one predicate rather than two reads.
    expect(viewer).toEqual([hitOn(manual, MANUAL), hitOn(handbook, HANDBOOK)]);
    expect(admin).toEqual([hitOn(manual, MANUAL)]);
    // The caller's limit is the caller's: the higher-ranked hit and nothing after it.
    expect(await searching(scenario.viewer, 1)).toEqual([hitOn(manual, MANUAL)]);
  });

  it("finds nothing for a Viewer outside the binding's audience and the passage for the Editor inside it", async () => {
    const scenario = await arrange();
    const board = await groupNamed(db(), scenario, "Board", [scenario.editor]);
    const minutes = await documentWithOneChunk(scenario.workspaceId, {
      ...MINUTES,
      sensitivity: "Internal",
      audienceGroups: [board],
    });

    const outside = await searching(scenario.viewer);
    const inside = await searching(scenario.editor);

    // The empty list and nothing beside it (`[TEST7]`, ADR 0016's *no totals anywhere*): no
    // count, no total and no *some results were withheld*, because each of those would tell a
    // reader outside the audience that there was something to be outside of.
    expect(outside).toEqual([]);
    expect(inside).toEqual([hitOn(minutes, MINUTES)]);
  });

  it("finds no chunk of a binding still under review, for a Viewer, an Editor or an Admin alike", async () => {
    const scenario = await arrange();
    await documentWithOneChunk(scenario.workspaceId, {
      ...DRAFT,
      sensitivity: "Internal",
      publishedAt: null,
    });

    const answered = [];
    for (const reader of [scenario.viewer, scenario.editor, scenario.admin]) {
      answered.push({ role: reader.role, found: await searching(reader) });
    }

    // The published arm has no door for any role, the Admin's included — the class arm is the
    // only one that reads the role. An unpublished binding's chunks are reached by the review
    // list alone, and that is `previewChunks`, not this read.
    expect(answered).toEqual([
      { role: "Viewer", found: [] },
      { role: "Editor", found: [] },
      { role: "Admin", found: [] },
    ]);
  });
});
