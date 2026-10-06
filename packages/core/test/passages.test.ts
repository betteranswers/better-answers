import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ulid } from "@better-answers/schema";

import { parse, type UserPrincipal } from "../src/kernel/index.ts";
import {
  findPassages,
  passageAt,
  previewChunks,
  previewChunksInput,
  type LocatorRefusal,
  type Passage,
  type PassageHit,
  type PreviewedChunk,
} from "../src/sources/index.ts";
import { contractFixture, documentChunkRow, OPEN_OUTCOMES } from "./contract-fixture.ts";
import {
  connectedSourceHolding,
  conceptCiting,
  groupNamed,
  seededBy,
  visibilitySuite,
} from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { answered } from "./suite-postgres.ts";

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
      expect: z.enum(OPEN_OUTCOMES),
      passage: z.string().optional(),
    }),
  ),
});

const fixture = contractFixture("document-chunk", fixtureSchema);
const { document } = fixture;
const NOT_FOUND = fixture.locator.not_found;

const { db, arrange, reading } = visibilitySuite();

const PUBLISHED = new Date("2026-09-11T09:00:00.000Z");

const INVOICE_TITLE = "The bid library's invoice";

const seedTheAgreementsDocument = (workspaceId: string): Promise<void> =>
  seededBy(db(), async (seed) => {
    const connectedSource = await seed.connectedSource({
      workspaceId,
      id: document.binding_id,
      publishedAt: PUBLISHED,
      sensitivity: "Internal",
    });
    await seed.sourceDocument({
      workspaceId,
      connectedSourceId: connectedSource.id,
      id: document.source_document_id,
      title: INVOICE_TITLE,
    });
    for (const row of document.chunks) {
      await seed.chunk({
        workspaceId,
        connectedSourceId: connectedSource.id,
        sourceDocumentId: document.source_document_id,
        id: row.id,
        ordinal: row.ordinal,
        charStart: row.char_start,
        charEnd: row.char_end,
        locator: row.locator,
        content: row.content,
      });
    }
  });

const documentWithOneChunk = (
  workspaceId: string,
  what: {
    readonly title: string;
    readonly text: string;
    readonly charEnd: number;
    readonly sensitivity: string;

    readonly audienceGroups?: readonly string[];

    readonly publishedAt?: Date | null;
  },
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const audience =
      what.audienceGroups === undefined
        ? { audience: "everyone", audienceGroups: null }
        : { audience: "groups", audienceGroups: [...what.audienceGroups] };
    const publishedAt = what.publishedAt === undefined ? PUBLISHED : what.publishedAt;
    const connectedSource = await seed.connectedSource({
      workspaceId,
      publishedAt,
      sensitivity: what.sensitivity,
      ...audience,
    });
    const held = await seed.sourceDocument({
      workspaceId,
      connectedSourceId: connectedSource.id,
      title: what.title,
    });
    await seed.chunk({
      workspaceId,
      connectedSourceId: connectedSource.id,
      sourceDocumentId: held.id,
      content: what.text,
      locator: `${held.id}/chars:0-${what.charEnd}`,
      ordinal: 0,
      charStart: 0,
      charEnd: what.charEnd,
    });
    return held.id;
  });

type StraddledRow = {
  readonly text: string;
  readonly charEnd: number;
};

/** A straddle's two rows can only be narrowed from above, never one row and not the other. */
const documentWithTwoChunks = (
  workspaceId: string,
  what: {
    readonly title: string;
    readonly leading: StraddledRow;
    readonly trailing: StraddledRow;
    readonly connectedSourceClass?: string;
    readonly documentClass?: string | null;
  },
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const connectedSourceClass = what.connectedSourceClass ?? "Internal";
    const documentClass = what.documentClass ?? null;
    const connectedSource = await seed.connectedSource({
      workspaceId,
      publishedAt: PUBLISHED,
      sensitivity: connectedSourceClass,
    });
    const held = await seed.sourceDocument({
      workspaceId,
      connectedSourceId: connectedSource.id,
      title: what.title,
      sensitivity: documentClass,
    });
    const rows = [
      { ...what.leading, ordinal: 0, charStart: 0 },
      { ...what.trailing, ordinal: 1, charStart: what.leading.charEnd },
    ];
    for (const row of rows) {
      await seed.chunk({
        workspaceId,
        connectedSourceId: connectedSource.id,
        sourceDocumentId: held.id,
        content: row.text,
        locator: `${held.id}/chars:${row.charStart}-${row.charEnd}`,
        ordinal: row.ordinal,
        charStart: row.charStart,
        charEnd: row.charEnd,
      });
    }
    return held.id;
  });

const STRADDLED_TITLE = "The staff handbook";
const STRADDLED_LEADING = { text: "The holiday policy ", charEnd: 19 } as const;
const STRADDLED_TRAILING = { text: "grants twenty-eight days.", charEnd: 44 } as const;
const STRADDLING_SPAN = "chars:4-43";

const BOARD_TITLE = "The board's note";
const BOARD_TEXT = "The board's note on the bid.";
const BOARD_CHAR_END = 28;

/**
 * Two bare words on purpose: to_tsquery raises a syntax error on prose, so this query breaks
 * a read that drops websearch_to_tsquery.
 */
const QUERY = "holiday policy";

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

const opening = async (
  person: UserPrincipal,
  wire: string,
): Promise<Passage | LocatorRefusal | Error> =>
  answered(
    await reading(person, async (reader, tx) => {
      const read = await passageAt(reader, tx, wire);
      return read.ok ? read.value : read.error;
    }),
  );

describe("the passage a wire locator opens", () => {
  it("answers every case the agreement states, the astral character included", async () => {
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

  it("serves a straddle as one passage at its effective class", async () => {
    const scenario = await arrange();

    const documentId = await documentWithTwoChunks(scenario.workspaceId, {
      title: STRADDLED_TITLE,
      leading: STRADDLED_LEADING,
      trailing: STRADDLED_TRAILING,
      connectedSourceClass: "Internal",
      documentClass: "Restricted",
    });
    const wire = `${documentId}/${STRADDLING_SPAN}`;

    const read = await opening(scenario.admin, wire);

    expect(read).toEqual({
      locator: wire,
      title: "The staff handbook",
      text: "holiday policy grants twenty-eight days",
      sensitivity: "Restricted",
    });
  });

  it("matches each row's locator to the one its columns compose", async () => {
    const scenario = await arrange();
    await seedTheAgreementsDocument(scenario.workspaceId);

    const rows = answered(
      await reading(scenario.admin, async (admin, tx) => {
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
      }),
    );

    expect(rows.length).toBe(document.chunks.length);
    expect(rows.map((row) => row.locator)).toEqual(
      rows.map((row) => `${row.source_document_id}/chars:${row.char_start}-${row.char_end}`),
    );
  });
});

describe("what a passage read refuses", () => {
  it("answers withheld, absent, malformed and out-of-range locators alike", async () => {
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

    expect(answered).toEqual({
      withheld: NOT_FOUND,
      absent: NOT_FOUND,
      malformed: NOT_FOUND,
      "out of range": NOT_FOUND,
    });
  });

  it("refuses a narrowed straddle whole, yet serves it to Admins", async () => {
    const scenario = await arrange();

    const narrowedConnectedSource = await documentWithTwoChunks(scenario.workspaceId, {
      title: STRADDLED_TITLE,
      leading: STRADDLED_LEADING,
      trailing: STRADDLED_TRAILING,
      connectedSourceClass: "Restricted",
    });
    const narrowedDocument = await documentWithTwoChunks(scenario.workspaceId, {
      title: STRADDLED_TITLE,
      leading: STRADDLED_LEADING,
      trailing: STRADDLED_TRAILING,
      documentClass: "Restricted",
    });
    const atNarrowedConnectedSource = `${narrowedConnectedSource}/${STRADDLING_SPAN}`;
    const atNarrowedDocument = `${narrowedDocument}/${STRADDLING_SPAN}`;

    const answered = {
      "the Viewer, connected source narrowed": await opening(
        scenario.viewer,
        atNarrowedConnectedSource,
      ),
      "the Viewer, document narrowed": await opening(scenario.viewer, atNarrowedDocument),
      "the Admin, connected source narrowed": await opening(
        scenario.admin,
        atNarrowedConnectedSource,
      ),
      "the Admin, document narrowed": await opening(scenario.admin, atNarrowedDocument),
    };

    expect(answered).toEqual({
      "the Viewer, connected source narrowed": NOT_FOUND,
      "the Viewer, document narrowed": NOT_FOUND,
      "the Admin, connected source narrowed": {
        locator: atNarrowedConnectedSource,
        title: "The staff handbook",
        text: "holiday policy grants twenty-eight days",
        sensitivity: "Restricted",
      },
      "the Admin, document narrowed": {
        locator: atNarrowedDocument,
        title: "The staff handbook",
        text: "holiday policy grants twenty-eight days",
        sensitivity: "Restricted",
      },
    });
  });

  it("serves an Admin the Restricted passage the Viewer is refused", async () => {
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

describe("what a passage read fails on", () => {
  it("errs on a chunk row whose content and span disagree", async () => {
    const scenario = await arrange();
    const runsPast = await documentWithOneChunk(scenario.workspaceId, {
      title: BOARD_TITLE,
      text: BOARD_TEXT,
      charEnd: 16,
      sensitivity: "Internal",
    });
    const fallsShort = await documentWithOneChunk(scenario.workspaceId, {
      title: BOARD_TITLE,
      text: BOARD_TEXT,
      charEnd: 40,
      sensitivity: "Internal",
    });

    const answered = {
      "past its span": await opening(scenario.viewer, `${runsPast}/chars:0-28`),
      "short of its span": await opening(scenario.viewer, `${fallsShort}/chars:0-40`),
    };

    expect(answered).toEqual({
      "past its span": new Error(`the chunk row at ${runsPast}/chars:0-16 holds 28 code points`),
      "short of its span": new Error(
        `the chunk row at ${fallsShort}/chars:0-40 holds 28 code points`,
      ),
    });
  });
});

const searching = async (
  person: UserPrincipal,
  limit = 10,
): Promise<readonly PassageHit[] | Error> =>
  answered(
    await reading(person, async (reader, tx) => {
      const found = await findPassages(reader, tx, QUERY, limit);
      return found.ok ? found.value : found.error;
    }),
  );

describe("the passages a search finds", () => {
  it("finds only passages no concept the reader sees rests on", async () => {
    const scenario = await arrange();
    const handbook = await documentWithOneChunk(scenario.workspaceId, {
      ...HANDBOOK,
      sensitivity: "Internal",
    });
    const manual = await documentWithOneChunk(scenario.workspaceId, {
      ...MANUAL,
      sensitivity: "Internal",
    });

    const boardroom = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    await conceptCiting(scenario, scenario.editor, [handbook, boardroom.documentId]);

    const viewer = await searching(scenario.viewer);
    const admin = await searching(scenario.admin);

    expect(viewer).toEqual([hitOn(manual, MANUAL), hitOn(handbook, HANDBOOK)]);
    expect(admin).toEqual([hitOn(manual, MANUAL)]);

    expect(await searching(scenario.viewer, 1)).toEqual([hitOn(manual, MANUAL)]);
  });

  it("finds a passage only for readers in the source's audience", async () => {
    const scenario = await arrange();
    const board = await groupNamed(db(), scenario, "Board", [scenario.editor]);
    const minutes = await documentWithOneChunk(scenario.workspaceId, {
      ...MINUTES,
      sensitivity: "Internal",
      audienceGroups: [board],
    });

    const outside = await searching(scenario.viewer);
    const inside = await searching(scenario.editor);

    expect(outside).toEqual([]);
    expect(inside).toEqual([hitOn(minutes, MINUTES)]);
  });

  it("finds no chunk of a source under review for anyone", async () => {
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

    expect(answered).toEqual([
      { role: "Viewer", found: [] },
      { role: "Editor", found: [] },
      { role: "Admin", found: [] },
    ]);
  });
});

const REVIEW_CONNECTED_SOURCE = "01M2B1ND1NGREV13WAAAAAAAAA";
const TERMS = "01M2D0CREV13WAAAAAAAAAAAA1";
const ANNEX = "01M2D0CREV13WAAAAAAAAAAAA2";

const ARMS_CONNECTED_SOURCE = "01M2B1ND1NGARMSAAAAAAAAAAA";
const GROUP_CONNECTED_SOURCE = "01M2B1ND1NGARMSGRPAAAAAAAA";
const BOARD_DOC = "01M2D0CARMSAAAAAAAAAAAAAA1";
const GROUP_DOC = "01M2D0CARMSAAAAAAAAAAAAAA2";

type ReviewedDocument = {
  readonly id: string;
  readonly title: string;
  readonly sensitivity?: string;
  readonly chunks: readonly {
    readonly id: string;
    readonly ordinal: number;
    readonly charStart: number;
    readonly charEnd: number;
    readonly content: string;
  }[];
};

const connectedSourceUnderReview = (
  workspaceId: string,
  connectedSourceId: string,
  documents: readonly ReviewedDocument[],
  onTheConnectedSource: { readonly audienceGroups?: readonly string[] } = {},
): Promise<void> =>
  seededBy(db(), async (seed) => {
    const { audienceGroups } = onTheConnectedSource;
    const audience =
      audienceGroups === undefined
        ? { audience: "everyone", audienceGroups: null }
        : { audience: "groups", audienceGroups: [...audienceGroups] };
    const connectedSource = await seed.connectedSource({
      workspaceId,
      id: connectedSourceId,
      publishedAt: null,
      sensitivity: "Internal",
      ...audience,
    });
    for (const held of documents) {
      await seed.sourceDocument({
        workspaceId,
        connectedSourceId: connectedSource.id,
        id: held.id,
        title: held.title,
        sensitivity: held.sensitivity ?? null,
      });
      for (const row of held.chunks) {
        await seed.chunk({
          workspaceId,
          connectedSourceId: connectedSource.id,
          sourceDocumentId: held.id,
          id: row.id,
          ordinal: row.ordinal,
          charStart: row.charStart,
          charEnd: row.charEnd,
          locator: `${held.id}/chars:${row.charStart}-${row.charEnd}`,
          content: row.content,
        });
      }
    }
  });

/**
 * Both documents hold a chunk matching the search's words, so an empty search over them is the
 * published arm at work, not an unmatched query.
 */
const seedTheConnectedSourceUnderReview = (workspaceId: string): Promise<void> =>
  connectedSourceUnderReview(workspaceId, REVIEW_CONNECTED_SOURCE, [
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

const previewing = async (
  person: UserPrincipal,
  connectedSourceId: string,
): Promise<readonly PreviewedChunk[] | string | Error> =>
  answered(
    await reading(person, async (reader, tx) => {
      const read = await previewChunks(
        reader,
        tx,
        inputOf(previewChunksInput, { connectedSourceId }),
      );
      return read.ok ? read.value : read.error;
    }),
  );

describe("the review list a connected source is previewed with", () => {
  it("lists every chunk by document and ordinal, to Admins alone", async () => {
    const scenario = await arrange();
    await seedTheConnectedSourceUnderReview(scenario.workspaceId);

    const admin = await previewing(scenario.admin, REVIEW_CONNECTED_SOURCE);
    const viewer = await previewing(scenario.viewer, REVIEW_CONNECTED_SOURCE);
    const editor = await previewing(scenario.editor, REVIEW_CONNECTED_SOURCE);

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

    expect(viewer).toBe("role-forbids");
    expect(editor).toBe("role-forbids");

    expect(parse(previewChunksInput, { connectedSourceId: "not-a-connected-source-id" })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { connectedSourceId: "bad-format" } },
    });
  });

  it("alone reaches the rows; neither search nor open does", async () => {
    const scenario = await arrange();
    await seedTheConnectedSourceUnderReview(scenario.workspaceId);

    const previewed = await previewing(scenario.admin, REVIEW_CONNECTED_SOURCE);
    const found = await searching(scenario.admin);
    const opened = await opening(scenario.admin, `${TERMS}/chars:0-33`);

    expect(previewed).toHaveLength(3);
    expect(found).toEqual([]);
    expect(opened).toBe(NOT_FOUND);
  });

  it("applies the class and audience arms all the same", async () => {
    const scenario = await arrange();
    const board = await groupNamed(db(), scenario, "Board", [scenario.editor]);
    await connectedSourceUnderReview(scenario.workspaceId, ARMS_CONNECTED_SOURCE, [
      {
        id: BOARD_DOC,
        title: "The board's draft",
        sensitivity: "Restricted",
        chunks: [
          {
            id: "01M2D0CARMSAAAAAAAAAAAAAA1#000000",
            ordinal: 0,
            charStart: 0,
            charEnd: 32,
            content: "The board's holiday policy note.",
          },
        ],
      },
    ]);
    await connectedSourceUnderReview(
      scenario.workspaceId,
      GROUP_CONNECTED_SOURCE,
      [
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
            },
          ],
        },
      ],
      { audienceGroups: [board] },
    );

    const reachedByClass = await previewing(scenario.admin, ARMS_CONNECTED_SOURCE);
    const withheldByAudience = await previewing(scenario.admin, GROUP_CONNECTED_SOURCE);

    expect(reachedByClass).toEqual([
      {
        id: "01M2D0CARMSAAAAAAAAAAAAAA1#000000",
        sourceDocumentId: BOARD_DOC,
        locator: "01M2D0CARMSAAAAAAAAAAAAAA1/chars:0-32",
        content: "The board's holiday policy note.",
      },
    ]);
    expect(withheldByAudience).toEqual([]);
  });
});
