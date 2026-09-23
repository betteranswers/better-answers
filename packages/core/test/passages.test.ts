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
import { contractFixture, documentChunkRow } from "./contract-fixture.ts";
import { inputOf } from "./suite-input.ts";
import {
  bindingHolding,
  conceptCiting,
  groupNamed,
  seededBy,
  visibilitySuite,
} from "./sourced-concept.ts";
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
      expect: z.enum(["passage", "not-found"]),
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
    });
    return held.id;
  });

type StraddledRow = {
  readonly text: string;
  readonly charEnd: number;
};

// A straddle's two rows can only be narrowed from above, never one row and not the other.
const documentWithTwoChunks = (
  workspaceId: string,
  what: {
    readonly title: string;
    readonly leading: StraddledRow;
    readonly trailing: StraddledRow;
    readonly bindingClass?: string;
    readonly documentClass?: string | null;
  },
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const bindingClass = what.bindingClass ?? "Internal";
    const documentClass = what.documentClass ?? null;
    const binding = await seed.sourceBinding({
      workspaceId,
      publishedAt: PUBLISHED,
      sensitivity: bindingClass,
    });
    const held = await seed.sourceDocument({
      workspaceId,
      bindingId: binding.id,
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
        bindingId: binding.id,
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

// Two bare words on purpose: to_tsquery raises a syntax error on prose, so this query breaks
// a read that drops websearch_to_tsquery.
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

  it("answers a span running from one chunk row into the next as one passage, at the narrower of its binding's class and its document's", async () => {
    const scenario = await arrange();

    const documentId = await documentWithTwoChunks(scenario.workspaceId, {
      title: STRADDLED_TITLE,
      leading: STRADDLED_LEADING,
      trailing: STRADDLED_TRAILING,
      bindingClass: "Internal",
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

  it("carries the locator the agreement writes on the row and the one composed from that row's own columns alike", async () => {
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

    expect(answered).toEqual({
      withheld: NOT_FOUND,
      absent: NOT_FOUND,
      malformed: NOT_FOUND,
      "out of range": NOT_FOUND,
    });
  });

  it("refuses a straddle whole when its binding or its document is narrowed, and serves the Admin who reaches both rows from the same locator", async () => {
    const scenario = await arrange();

    const narrowedBinding = await documentWithTwoChunks(scenario.workspaceId, {
      title: STRADDLED_TITLE,
      leading: STRADDLED_LEADING,
      trailing: STRADDLED_TRAILING,
      bindingClass: "Restricted",
    });
    const narrowedDocument = await documentWithTwoChunks(scenario.workspaceId, {
      title: STRADDLED_TITLE,
      leading: STRADDLED_LEADING,
      trailing: STRADDLED_TRAILING,
      documentClass: "Restricted",
    });
    const atNarrowedBinding = `${narrowedBinding}/${STRADDLING_SPAN}`;
    const atNarrowedDocument = `${narrowedDocument}/${STRADDLING_SPAN}`;

    const answered = {
      "the Viewer, binding narrowed": await opening(scenario.viewer, atNarrowedBinding),
      "the Viewer, document narrowed": await opening(scenario.viewer, atNarrowedDocument),
      "the Admin, binding narrowed": await opening(scenario.admin, atNarrowedBinding),
      "the Admin, document narrowed": await opening(scenario.admin, atNarrowedDocument),
    };

    expect(answered).toEqual({
      "the Viewer, binding narrowed": NOT_FOUND,
      "the Viewer, document narrowed": NOT_FOUND,
      "the Admin, binding narrowed": {
        locator: atNarrowedBinding,
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

describe("what a passage read fails on", () => {
  it("answers a row whose content runs past or short of its span as the store's error, never as a passage or a refusal", async () => {
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

    const boardroom = await bindingHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    await conceptCiting(scenario, scenario.editor, [handbook, boardroom.documentId]);

    const viewer = await searching(scenario.viewer);
    const admin = await searching(scenario.admin);

    expect(viewer).toEqual([hitOn(manual, MANUAL), hitOn(handbook, HANDBOOK)]);
    expect(admin).toEqual([hitOn(manual, MANUAL)]);

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

    expect(answered).toEqual([
      { role: "Viewer", found: [] },
      { role: "Editor", found: [] },
      { role: "Admin", found: [] },
    ]);
  });
});

const REVIEW_BINDING = "01M2B1ND1NGREV13WAAAAAAAAA";
const TERMS = "01M2D0CREV13WAAAAAAAAAAAA1";
const ANNEX = "01M2D0CREV13WAAAAAAAAAAAA2";

const ARMS_BINDING = "01M2B1ND1NGARMSAAAAAAAAAAA";
const GROUP_BINDING = "01M2B1ND1NGARMSGRPAAAAAAAA";
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

const bindingUnderReview = (
  workspaceId: string,
  bindingId: string,
  documents: readonly ReviewedDocument[],
  onTheBinding: { readonly audienceGroups?: readonly string[] } = {},
): Promise<void> =>
  seededBy(db(), async (seed) => {
    const { audienceGroups } = onTheBinding;
    const audience =
      audienceGroups === undefined
        ? { audience: "everyone", audienceGroups: null }
        : { audience: "groups", audienceGroups: [...audienceGroups] };
    const binding = await seed.sourceBinding({
      workspaceId,
      id: bindingId,
      publishedAt: null,
      sensitivity: "Internal",
      ...audience,
    });
    for (const held of documents) {
      await seed.sourceDocument({
        workspaceId,
        bindingId: binding.id,
        id: held.id,
        title: held.title,
        sensitivity: held.sensitivity ?? null,
      });
      for (const row of held.chunks) {
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
        });
      }
    }
  });

// Both documents hold a chunk matching the words the search asks, so the empty answer below
// is the published arm, not an unmatched query.
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

const previewing = async (
  person: UserPrincipal,
  bindingId: string,
): Promise<readonly PreviewedChunk[] | string | Error> =>
  answered(
    await reading(person, async (reader, tx) => {
      const read = await previewChunks(reader, tx, inputOf(previewChunksInput, { bindingId }));
      return read.ok ? read.value : read.error;
    }),
  );

describe("the review list a binding is previewed with", () => {
  it("hands an Admin every chunk of a binding still under review, in document and ordinal order, and refuses a Viewer and an Editor", async () => {
    const scenario = await arrange();
    await seedTheBindingUnderReview(scenario.workspaceId);

    const admin = await previewing(scenario.admin, REVIEW_BINDING);
    const viewer = await previewing(scenario.viewer, REVIEW_BINDING);
    const editor = await previewing(scenario.editor, REVIEW_BINDING);

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

    expect(parse(previewChunksInput, { bindingId: "not-a-binding-id" })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { bindingId: "bad-format" } },
    });
  });

  it("is the only road to those rows: the same Admin finds none of them by search and opens none of them by locator", async () => {
    const scenario = await arrange();
    await seedTheBindingUnderReview(scenario.workspaceId);

    const previewed = await previewing(scenario.admin, REVIEW_BINDING);
    const found = await searching(scenario.admin);
    const opened = await opening(scenario.admin, `${TERMS}/chars:0-33`);

    expect(previewed).toHaveLength(3);
    expect(found).toEqual([]);
    expect(opened).toBe(NOT_FOUND);
  });

  it("applies the class and the audience arms all the same, so an Admin lists a Restricted document's chunks and none of a binding for a group they are not in", async () => {
    const scenario = await arrange();
    const board = await groupNamed(db(), scenario, "Board", [scenario.editor]);
    await bindingUnderReview(scenario.workspaceId, ARMS_BINDING, [
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
    await bindingUnderReview(
      scenario.workspaceId,
      GROUP_BINDING,
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

    const reachedByClass = await previewing(scenario.admin, ARMS_BINDING);
    const withheldByAudience = await previewing(scenario.admin, GROUP_BINDING);

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
