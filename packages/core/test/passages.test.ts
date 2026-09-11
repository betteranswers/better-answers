import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ulid } from "@better-answers/schema";

import type { UserPrincipal } from "../src/kernel/index.ts";
import {
  findPassages,
  passageAt,
  previewChunks,
  type LocatorRefusal,
  type Passage,
  type PassageHit,
  type PreviewedChunk,
} from "../src/sources/index.ts";
import { contractFixture, documentChunkRow } from "./contract-fixture.ts";
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
 *
 * And last `previewChunks`, the Admin's review list, whose own pair both ways (`[TEST7]`) is
 * the binding still under review: its rows are there for the preview, which leaves the
 * published arm out, and not there for the two reads that carry it — for the same Admin, in
 * the same workspace, on the same arrangement. The arms it keeps are proved too, because a
 * road that reaches earlier must not also reach wider.
 */

const fixtureSchema = z.object({
  locator: z.object({ not_found: z.string().min(1) }),
  document: z.object({
    source_document_id: z.string().min(1),
    binding_id: z.string().min(1),
    chunks: z.array(documentChunkRow),
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

/**
 * The passage this person opens at a wire locator, or the one word they were refused with.
 *
 * The act alone, as `searching` and `previewing` below are the act alone for the other two
 * reads: what a passage is expected to be stays written out in full at every assertion, in
 * that assertion's own literals (`[TEST9]`), because that is the thing under test and a
 * helper that carried it would be the suite agreeing with itself.
 */
const opening = (person: UserPrincipal, wire: string): Promise<Passage | LocatorRefusal | Error> =>
  reading(person, async (reader, tx) => {
    const read = await passageAt(reader, tx, wire);
    return read.ok ? read.value : read.error;
  });

describe("the passage a wire locator opens", () => {
  it("answers every case the document-chunk agreement states, the astral character included", async () => {
    const scenario = await arrange();
    await seedTheAgreementsDocument(scenario.workspaceId);

    const answered = [];
    for (const opened of fixture.open) {
      answered.push({ case: opened.case, answer: await opening(scenario.viewer, opened.wire) });
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

    const read = await opening(scenario.admin, wire);

    expect(read).toEqual({
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
      answered[what] = await opening(scenario.viewer, wire);
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

    const read = await opening(scenario.admin, wire);

    expect(read).toEqual({
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

/**
 * The binding the Sources screen reviews and the rows a run landed under it, at ids this suite
 * writes down rather than mints, so the addresses and the order the preview answers in are
 * literals (`[TEST9]`) instead of values read back out of the arrangement.
 */
const REVIEW_BINDING = "01M2B1ND1NGREV13WAAAAAAAAA";
const TERMS = "01M2D0CREV13WAAAAAAAAAAAA1";
const ANNEX = "01M2D0CREV13WAAAAAAAAAAAA2";

/** The second binding, for the two arms the preview keeps; its documents sort in this order. */
const ARMS_BINDING = "01M2B1ND1NGARMSAAAAAAAAAAA";
const BOARD_DOC = "01M2D0CARMSAAAAAAAAAAAAAA1";
const GROUP_DOC = "01M2D0CARMSAAAAAAAAAAAAAA2";

/** One document of a binding under review and the rows the splitter would have written for it. */
type ReviewedDocument = {
  readonly id: string;
  readonly title: string;
  readonly chunks: readonly {
    readonly id: string;
    readonly ordinal: number;
    readonly charStart: number;
    readonly charEnd: number;
    readonly content: string;
    readonly sensitivity?: string;
    /** The groups the row is for; absent is *everyone*, which is what most rows carry. */
    readonly audienceGroups?: readonly string[];
  }[];
};

/**
 * A binding still under review, its documents and their chunk rows.
 *
 * `published_at` is null on the binding **and** on every chunk copy, which is the state a
 * review list exists for: a run writes the binding's three visibility columns onto its chunks
 * (ADR 0023), so a suite that set the two apart would be arranging something no writer can
 * produce. Every row names all five address columns, because `seed.chunk` leaves them NULL and
 * would otherwise mint a binding id of its own.
 */
const bindingUnderReview = (
  workspaceId: string,
  bindingId: string,
  documents: readonly ReviewedDocument[],
): Promise<void> =>
  seededBy(db(), async (seed) => {
    const binding = await seed.sourceBinding({
      workspaceId,
      id: bindingId,
      publishedAt: null,
      sensitivity: "Internal",
    });
    for (const held of documents) {
      await seed.sourceDocument({
        workspaceId,
        bindingId: binding.id,
        id: held.id,
        title: held.title,
      });
      for (const row of held.chunks) {
        const audience =
          row.audienceGroups === undefined
            ? { audience: "everyone", audienceGroups: null }
            : { audience: "groups", audienceGroups: [...row.audienceGroups] };
        await seed.chunk({
          workspaceId,
          bindingId: binding.id,
          sourceDocumentId: held.id,
          id: row.id,
          ordinal: row.ordinal,
          charStart: row.charStart,
          charEnd: row.charEnd,
          locator: `${held.id}/chars:${row.charStart}-${row.charEnd}`,
          content: row.content,
          publishedAt: null,
          sensitivity: row.sensitivity ?? "Internal",
          ...audience,
        });
      }
    }
  });

/**
 * The binding under review this suite previews: two documents, three rows, every one of them
 * matching the words `findPassages` is asked with, so the search's empty answer below is the
 * published arm and never a query that had nothing to match in the first place.
 */
const seedTheBindingUnderReview = (workspaceId: string): Promise<void> =>
  bindingUnderReview(workspaceId, REVIEW_BINDING, [
    {
      id: TERMS,
      title: "The draft terms",
      chunks: [
        {
          id: "01M2D0CREV13WAAAAAAAAAAAA1#000000",
          ordinal: 0,
          charStart: 0,
          charEnd: 33,
          content: "The holiday policy under review, ",
        },
        {
          id: "01M2D0CREV13WAAAAAAAAAAAA1#000001",
          ordinal: 1,
          charStart: 33,
          charEnd: 54,
          content: "still to be approved.",
        },
      ],
    },
    {
      id: ANNEX,
      title: "The draft annex",
      chunks: [
        {
          id: "01M2D0CREV13WAAAAAAAAAAAA2#000000",
          ordinal: 0,
          charStart: 0,
          charEnd: 32,
          content: "The annex to the holiday policy.",
        },
      ],
    },
  ]);

/** The review list this person is handed, or the one word they were refused with. */
const previewing = (
  person: UserPrincipal,
  bindingId: string,
): Promise<readonly PreviewedChunk[] | string | Error> =>
  reading(person, async (reader, tx) => {
    const read = await previewChunks(reader, tx, { bindingId });
    return read.ok ? read.value : read.error;
  });

describe("the review list a binding is previewed with", () => {
  it("hands an Admin every chunk of a binding still under review, in document and ordinal order, and refuses a Viewer and an Editor", async () => {
    const scenario = await arrange();
    await seedTheBindingUnderReview(scenario.workspaceId);

    const admin = await previewing(scenario.admin, REVIEW_BINDING);
    const viewer = await previewing(scenario.viewer, REVIEW_BINDING);
    const editor = await previewing(scenario.editor, REVIEW_BINDING);

    // The rows in the order the screen lists them, each with the address it will open at once
    // the binding is published — composed from the row's three columns, never read out of its
    // own `locator` column, so the two cannot drift apart unnoticed (ADR 0031).
    expect(admin).toEqual([
      {
        id: "01M2D0CREV13WAAAAAAAAAAAA1#000000",
        sourceDocumentId: TERMS,
        locator: "01M2D0CREV13WAAAAAAAAAAAA1/chars:0-33",
        content: "The holiday policy under review, ",
      },
      {
        id: "01M2D0CREV13WAAAAAAAAAAAA1#000001",
        sourceDocumentId: TERMS,
        locator: "01M2D0CREV13WAAAAAAAAAAAA1/chars:33-54",
        content: "still to be approved.",
      },
      {
        id: "01M2D0CREV13WAAAAAAAAAAAA2#000000",
        sourceDocumentId: ANNEX,
        locator: "01M2D0CREV13WAAAAAAAAAAAA2/chars:0-32",
        content: "The annex to the holiday policy.",
      },
    ]);
    // The role is decided before anything is read, so neither of the other two learns whether
    // the binding exists, let alone what is under it.
    expect(viewer).toBe("role-forbids");
    expect(editor).toBe("role-forbids");
    // The shape is decided after the role and before the read, as every act on this slice
    // decides it: an Admin asking with something that is not a binding id gets the other word.
    expect(await previewing(scenario.admin, "not-a-binding-id")).toBe("malformed");
  });

  it("is the only road to those rows: the same Admin finds none of them by search and opens none of them by locator", async () => {
    const scenario = await arrange();
    await seedTheBindingUnderReview(scenario.workspaceId);

    const previewed = await previewing(scenario.admin, REVIEW_BINDING);
    const found = await searching(scenario.admin);
    const opened = await opening(scenario.admin, `${TERMS}/chars:0-33`);

    // The pair both ways (`[TEST7]`) on one arrangement and one person: three rows for the
    // preview, which leaves the published arm out, and nothing at all for the two reads that
    // carry it. Were the preview ever to grow that arm the first expectation would fail; were
    // either read ever to lose it, the other two would.
    expect(previewed).toHaveLength(3);
    expect(found).toEqual([]);
    expect(opened).toBe(NOT_FOUND);
  });

  it("applies the class and the audience arms all the same, so an Admin reaches a Restricted row and not a row for a group they are not in", async () => {
    const scenario = await arrange();
    const board = await groupNamed(db(), scenario, "Board", [scenario.editor]);
    await bindingUnderReview(scenario.workspaceId, ARMS_BINDING, [
      {
        id: BOARD_DOC,
        title: "The board's draft",
        chunks: [
          {
            id: "01M2D0CARMSAAAAAAAAAAAAAA1#000000",
            ordinal: 0,
            charStart: 0,
            charEnd: 32,
            content: "The board's holiday policy note.",
            sensitivity: "Restricted",
          },
        ],
      },
      {
        id: GROUP_DOC,
        title: "The Board group's draft",
        chunks: [
          {
            id: "01M2D0CARMSAAAAAAAAAAAAAA2#000000",
            ordinal: 0,
            charStart: 0,
            charEnd: 32,
            content: "The group's holiday policy note.",
            audienceGroups: [board],
          },
        ],
      },
    ]);

    const admin = await previewing(scenario.admin, ARMS_BINDING);

    // The clause reads the role in its class arm alone: `Restricted` has a door for an Admin
    // and the audience has none, for any role. Dropping the published arm therefore reaches
    // earlier without reaching wider — an Admin outside a group is still outside it, and the
    // Editor inside it is who this second row would be shown to were it ever published.
    expect(admin).toEqual([
      {
        id: "01M2D0CARMSAAAAAAAAAAAAAA1#000000",
        sourceDocumentId: BOARD_DOC,
        locator: "01M2D0CARMSAAAAAAAAAAAAAA1/chars:0-32",
        content: "The board's holiday policy note.",
      },
    ]);
  });
});
