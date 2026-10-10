import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { ids, type ConceptIri } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import {
  ask,
  find,
  findInput,
  findOutputWith,
  giveFeedback,
  mapWords,
  NOT_ANSWERED,
  NOT_COMPANY_KNOWLEDGE,
  open,
  openInput,
  openOutputWith,
  renderAnswer,
  renderFeedback,
  renderFind,
  renderOpen,
  type AnswerResult,
  type FeedbackReason,
  type FeedbackReceipt,
  type FindResult,
  type OpenResult,
  type Trust,
} from "../src/answering/index.ts";
import { parse, type Result, type Role, type UserPrincipal } from "../src/kernel/index.ts";
import type { Foldable, Folded, Tx } from "../src/store/postgres/index.ts";
import {
  codePointsOf,
  documentLanded,
  groupSeeded,
  PUBLISHED_AT,
  type DocumentShape,
  type LandedDocument,
} from "./suite-documents.ts";
import { postgresForSuite, readingAs } from "./suite-postgres.ts";

const db = postgresForSuite();

const arrange = async (
  role: Role = "Viewer",
): Promise<{ readonly workspaceId: string; readonly userId: string }> => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const workspace = await seed.workspace();
    const member = await seed.member({ workspaceId: workspace.id, role });
    return { workspaceId: workspace.id, userId: member.userId };
  } finally {
    client.release();
  }
};

const acting = <T>(
  reader: { readonly workspaceId: string; readonly userId: string },
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T>> => readingAs(db().runtimePool, reader, work);

const answer = (overrides: Partial<AnswerResult>): AnswerResult => ({
  verdict: "ok",
  text: "The company holds ISO/IEC 27001:2022.",
  citations: [{ iri: "https://better-answers.com/c/01A", url: "https://app.example/c/01A" }],
  conflicts: [],
  coverage: { asked: 1, answered: 1 },
  unmappedPassages: [],
  map: { state: "live" },
  ...overrides,
});

const unverified: Trust = {
  tier: "unverified",
  status: "current",
  verifiedBy: null,
  verifiedAt: null,
  rider: null,
};

/** Core's own trust, handed to an output schema as an edge that renames nothing would. */
const trust = z.custom<Trust>();

const messagesOf = (parsed: { readonly error?: z.ZodError }): readonly string[] | undefined =>
  parsed.error?.issues.map(({ message }) => message);

/** Whether each field carries the words an MCP client's model reads beside it. */
const described = (shape: Readonly<Record<string, z.ZodType>>): Readonly<Record<string, boolean>> =>
  Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [key, (field.description ?? "").trim() !== ""]),
  );

describe("the answer's rendering", () => {
  it("puts the verdict first and the map's line second", () => {
    expect(renderAnswer(answer({})).split("\n").slice(0, 2)).toEqual([
      "**Answered from the company's knowledge.**",
      "_map as of now_",
    ]);
    expect(mapWords({ state: "as_of", at: "2026-09-01T10:00:00Z" })).toBe(
      "map as of 1 September 2026",
    );
    expect(mapWords({ state: "unavailable_since", since: "2026-09-01T10:00:00Z" })).toBe(
      "map unavailable since 1 September 2026",
    );
    expect(
      renderAnswer(answer({ map: { state: "unavailable_since", since: "2026-09-01" } })),
    ).toContain("_map unavailable since 1 September 2026_");
  });

  it("puts the text after the map line, then numbered citations", () => {
    expect(
      renderAnswer(
        answer({
          citations: [
            { iri: "https://better-answers.com/c/01A", url: "https://app.example/c/01A" },
            { iri: "https://better-answers.com/c/01B", url: "https://app.example/c/01B" },
          ],
        }),
      ),
    ).toBe(
      [
        "**Answered from the company's knowledge.**",
        "_map as of now_",
        "",
        "The company holds ISO/IEC 27001:2022.",
        "",
        "[1] https://better-answers.com/c/01A — https://app.example/c/01A",
        "[2] https://better-answers.com/c/01B — https://app.example/c/01B",
      ].join("\n"),
    );
  });

  it("warns for the caller's role in the verdict line alone", () => {
    expect(renderAnswer(answer({ verdict: "warn", citations: [] }))).toBe(
      [
        "**Answered with a warning for your role.**",
        "_map as of now_",
        "",
        "The company holds ISO/IEC 27001:2022.",
      ].join("\n"),
    );
  });

  it("renders a refusal as the one sentence plus unmapped passages", () => {
    expect(
      renderAnswer(
        answer({
          verdict: "refuse",
          text: NOT_ANSWERED,
          citations: [],
          unmappedPassages: [
            {
              locator: "p.4",
              source: "Policy.pdf",
              text: "Retained for six years.",
              sensitivity: "Internal",
            },
            {
              locator: "p.7",
              source: "Policy.pdf",
              text: "Deleted after that.",
              sensitivity: "Restricted",
            },
          ],
        }),
      ),
    ).toBe(
      [
        "**Not answered from the company's knowledge.**",
        "_map as of now_",
        "",
        "Not company knowledge · Internal",
        "> Retained for six years.",
        "— Policy.pdf (p.4)",
        "",
        "Not company knowledge · Restricted",
        "> Deleted after that.",
        "— Policy.pdf (p.7)",
      ].join("\n"),
    );
  });
});

describe("the preview's rendering", () => {
  it("says nothing matches when empty, else one line per match", () => {
    expect(renderFind({ query: "expenses", matches: [] })).toBe(
      "Nothing in the company's knowledge matches that.",
    );
    expect(
      renderFind({
        query: "expenses",
        matches: [
          {
            layer: "bundles",
            iri: "https://better-answers.com/c/01A",
            kind: "Policy",
            title: "Expenses",
            trust: unverified,
            trustWords: "Unverified",
            bundle: "acme",
            tags: [],
          },
          {
            layer: "bundles",
            iri: "https://better-answers.com/c/01B",
            kind: "Guide",
            title: "Travel",
            trust: {
              tier: "human-reviewed",
              status: "current",
              verifiedBy: "Priya Shah",
              verifiedAt: "2026-03-03",
              rider: null,
            },
            trustWords: "Verified by Priya Shah · 3 March 2026",
            bundle: "acme",
            tags: ["travel"],
          },
        ],
      }),
    ).toBe(
      [
        "Policy · Expenses · Unverified · https://better-answers.com/c/01A",
        "Guide · Travel · Verified by Priya Shah · 3 March 2026 · https://better-answers.com/c/01B",
      ].join("\n"),
    );
  });

  it("writes out the cursor when more matches follow", () => {
    expect(
      renderFind({
        query: "invoice",
        matches: [
          {
            layer: "sources",
            kind: "document",
            title: "The bid library's invoice",
            locator: "01J6DDDDDDDDDDDDDDDDDDDDDD/chars:0-44",
            sensitivity: "Internal",
          },
        ],
        nextCursor: "eyJydW4iOiJ3ZWFrIn0",
      }),
    ).toBe(
      [
        "document · The bid library's invoice · Not company knowledge · Internal · 01J6DDDDDDDDDDDDDDDDDDDDDD/chars:0-44",
        "",
        "More follow: call find again with cursor eyJydW4iOiJ3ZWFrIn0",
      ].join("\n"),
    );
  });
});

describe("open's and feedback's renderings", () => {
  it("quotes a passage with its source, locator and sensitivity word", () => {
    expect(
      renderOpen({
        found: true,
        passage: {
          locator: "p.4",
          source: "Policy.pdf",
          text: "Retained.",
          sensitivity: "Internal",
        },
      }),
    ).toBe("> Retained.\n\n— Policy.pdf (p.4) · Internal");
    expect(renderOpen({ found: false, locator: "p.9" })).toBe("No passage at p.9.");
  });

  it("renders a concept's title, body, trust caption and cited evidence", () => {
    expect(
      renderOpen({
        found: true,
        concept: {
          iri: "https://better-answers.com/c/01A",
          frontmatter: { title: "Expenses", type: "Policy" },
          body: "Expenses are claimed within thirty days.",
          relations: [],
          trust: unverified,
          trustWords: "Unverified",
          evidence: [
            { locator: "p.4", source: "Handbook" },
            { locator: "p.9", source: "Travel policy" },
          ],
        },
      }),
    ).toBe(
      [
        "# Expenses",
        "",
        "Expenses are claimed within thirty days.",
        "",
        "_Unverified_",
        "",
        "Evidence:",
        "- Handbook (p.4)",
        "- Travel policy (p.9)",
      ].join("\n"),
    );
  });

  it("renders each source's opening and the concept's relations", () => {
    expect(
      renderOpen({
        found: true,
        concept: {
          iri: "https://better-answers.com/c/01A",
          frontmatter: { title: "Expenses", type: "Policy" },
          body: "Expenses follow the travel policy.",
          relations: [
            {
              kind: "LINKS_TO",
              target: "https://better-answers.com/c/01B",
              title: "Travel policy",
            },
          ],
          trust: unverified,
          trustWords: "Unverified",
          evidence: [
            { id: "T-1", source: "Travel policy", iri: "https://better-answers.com/c/01B" },
            { id: "M-2", source: "The board's minutes" },
            { id: "B-3", source: "Bid library", at: "p.4" },
          ],
        },
      }),
    ).toBe(
      [
        "# Expenses",
        "",
        "Expenses follow the travel policy.",
        "",
        "_Unverified_",
        "",
        "Evidence:",
        "- Travel policy (https://better-answers.com/c/01B)",
        "- The board's minutes",
        "- Bid library, p.4",
        "",
        "Related:",
        "- LINKS_TO · Travel policy · https://better-answers.com/c/01B",
      ].join("\n"),
    );
  });

  it("heads an untitled concept with its IRI, omitting empty evidence", () => {
    expect(
      renderOpen({
        found: true,
        concept: {
          iri: "https://better-answers.com/c/01B",
          frontmatter: { type: "Policy" },
          body: "Travel is booked in advance.",
          relations: [],
          trust: {
            tier: "human-reviewed",
            status: "current",
            verifiedBy: "Priya Shah",
            verifiedAt: "2026-03-03",
            rider: null,
          },
          trustWords: "Verified by Priya Shah · 3 March 2026",
          evidence: [],
        },
      }),
    ).toBe(
      [
        "# https://better-answers.com/c/01B",
        "",
        "Travel is booked in advance.",
        "",
        "_Verified by Priya Shah · 3 March 2026_",
      ].join("\n"),
    );
  });

  it("names what was asked where there is nothing to show", () => {
    expect(renderOpen({ found: false, iri: "https://better-answers.com/c/01C" })).toBe(
      "No concept at https://better-answers.com/c/01C.",
    );

    expect(renderOpen({ found: false })).toBe("No passage at that link.");
    expect(renderOpen({ found: true })).toBe("Nothing to show.");
  });

  it("renders feedback and each flag reason in words, not tokens", () => {
    const iri = "https://better-answers.com/c/01A";
    const received = (what: string): string =>
      `Received: ${iri} marked ${what}. It reaches the owner when the Suggestions page ships.`;
    const flagged = (reason: FeedbackReason, detail?: string): string =>
      renderFeedback({
        outcome: "received",
        feedback: { iri, verdict: "flag", reason, ...(detail === undefined ? {} : { detail }) },
      });

    expect(renderFeedback({ outcome: "received", feedback: { iri, verdict: "helpful" } })).toBe(
      received("helpful"),
    );
    expect(flagged("out-of-date", "renewed in May")).toBe(
      received('flagged as out of date — "renewed in May"'),
    );
    expect(flagged("wrong")).toBe(received("flagged as wrong"));
    expect(flagged("incomplete")).toBe(received("flagged as incomplete"));
    expect(flagged("should-not-have-shown")).toBe(
      received("flagged as should not have been shown"),
    );
  });
});

describe("what the slice's four actions answer", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("hands every caller an outcome to read, not to catch", () => {
    expectTypeOf(find).returns.resolves.toEqualTypeOf<Result<FindResult, "role-forbids" | Error>>();
    expectTypeOf(open).returns.resolves.toEqualTypeOf<Result<OpenResult, "role-forbids" | Error>>();
    expectTypeOf(ask).returns.resolves.toEqualTypeOf<
      Result<AnswerResult, "role-forbids" | Error>
    >();
    expectTypeOf(giveFeedback).returns.resolves.toEqualTypeOf<
      Result<FeedbackReceipt, "role-forbids">
    >();
  });

  it("answers the query and no matches when neither arm finds", async () => {
    const reader = await arrange();

    const found = await acting(reader, (principal, tx) =>
      find(principal, tx, { query: "expenses", limit: 10 }, now),
    );

    expect(found).toEqual({ ok: true, value: { query: "expenses", matches: [] } });
  });

  it("refuses every question with the one sentence, the map live", async () => {
    const reader = await arrange();

    const answered = await acting(reader, (principal, tx) =>
      ask(principal, tx, { question: "How long do we have to claim expenses?" }),
    );

    expect(answered).toEqual({
      ok: true,
      value: {
        verdict: "refuse",
        text: "Not answered from the company's knowledge.",
        citations: [],
        conflicts: [],
        coverage: { asked: 1, answered: 0 },
        unmappedPassages: [],
        map: { state: "live" },
      },
    });
  });

  it("hands a reader a receipt echoing their feedback", async () => {
    const reader = await arrange();
    const feedback = {
      iri: "https://better-answers.com/c/01A",
      verdict: "flag",
      reason: "wrong",
      detail: "renewed in May",
    } as const;

    const receipt = await acting(reader, (principal, tx) => giveFeedback(principal, tx, feedback));

    expect(receipt).toEqual({ ok: true, value: { outcome: "received", feedback } });
  });

  it("refuses feedback and ask a role outside the three", async () => {
    const reader = await arrange();
    // @ts-expect-error — a role no resolver hands out is the value each face must still refuse.
    const stranger = (principal: UserPrincipal): UserPrincipal => ({ ...principal, role: "Owner" });

    const receipt = await acting(reader, (principal, tx) =>
      giveFeedback(stranger(principal), tx, { iri: "urn:x", verdict: "helpful" }),
    );
    const answered = await acting(reader, (principal, tx) =>
      ask(stranger(principal), tx, { question: "When is the audit?" }),
    );

    expect([receipt, answered]).toEqual([
      { ok: false, error: "role-forbids" },
      { ok: false, error: "role-forbids" },
    ]);
  });

  it("answers a locator that is no address as not found", async () => {
    const reader = await arrange();

    const opened = await acting(reader, (principal, tx) =>
      open(principal, tx, { locator: "p.4" }, now),
    );

    expect(opened).toEqual({ ok: true, value: { found: false, locator: "p.4" } });
  });

  it("answers a failed read as an error, never a concept", async () => {
    const reader = await arrange();
    let answered: Result<OpenResult, Error> | undefined;

    await expect(
      acting(reader, async (principal, tx) => {
        await tx.query("SELECT 1 / 0").catch(() => undefined);
        // @ts-expect-error a read that fails before any row is read needs no minted iri
        answered = await open(principal, tx, { iri: "https://better-answers.com/c/01A" }, now);
      }),
    ).rejects.toThrow("the transaction did not commit");

    expect(answered?.ok).toBe(false);
  });

  it.each(["Editor", "Viewer"] as const)("admits an %s to find and open", async (role) => {
    const reader = await arrange(role);

    const found = await acting(reader, (principal, tx) =>
      find(principal, tx, { query: "expenses", limit: 10 }, now),
    );
    const opened = await acting(reader, (principal, tx) =>
      open(principal, tx, { iri: ABSENT }, now),
    );

    expect(found).toEqual({ ok: true, value: { query: "expenses", matches: [] } });
    expect(opened).toEqual({ ok: true, value: { found: false, iri: ABSENT } });
  });
});

const ABSENT = ids.conceptIri.parse("https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ");

describe("the boundary find and open are parsed at", () => {
  it("refuses a query holding a NUL as malformed", () => {
    expect(parse(findInput, { query: "audit\u0000logs" })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { query: "refused" } },
    });
    expect(messagesOf(findInput.safeParse({ query: "audit\u0000logs" }))).toEqual([
      "a query holds no NUL character",
    ]);
  });

  it("holds a page to 1–20 matches, 5 when unasked", () => {
    expect(parse(findInput, { query: "audit" })).toEqual({
      ok: true,
      value: { query: "audit", limit: 5 },
    });
    expect(parse(findInput, { query: "audit", limit: 21 })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { limit: "too-big" } },
    });
    expect(parse(findInput, { query: "audit", limit: 0 })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { limit: "too-small" } },
    });
  });

  it.each([
    ["not base64url", "not a cursor!", "bad-format"],
    ["no position find hands out", "e30", "refused"],
  ])("refuses a cursor that is %s", (_case, cursor, issue) => {
    expect(parse(findInput, { query: "audit", cursor })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { cursor: issue } },
    });
  });

  it("reads a cursor back into the position it names", () => {
    const cursor =
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsibWF0Y2hlZCI6MSwicmFuayI6MC41LCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZaWlpaWlpaWlpaWlpaWlpaWlpaWlpaIn19";

    expect(parse(findInput, { query: "audit", cursor })).toEqual({
      ok: true,
      value: {
        query: "audit",
        limit: 5,
        cursor: { run: "weak", bound: { matched: 1, rank: 0.5, key: ABSENT } },
      },
    });
  });

  it("refuses a malformed iri as malformed", () => {
    expect(parse(openInput, { iri: "not a concept iri" })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { iri: "bad-format" } },
    });
  });

  it.each([
    ["both an iri and a locator", { iri: ABSENT, locator: "p.4" }],
    ["neither an iri nor a locator", {}],
  ])("refuses open given %s", (_case, input) => {
    expect(parse(openInput, input)).toEqual({
      ok: false,
      error: { word: "malformed", fields: { "": "refused" } },
    });
    expect(messagesOf(openInput.safeParse(input))).toEqual([
      "give an `iri` or a `locator`, not both and not neither",
    ]);
  });

  it("describes every find and open input field", () => {
    expect(described(findInput.shape)).toEqual({ query: true, limit: true, cursor: true });
    expect(described(openInput.shape)).toEqual({ iri: true, locator: true });
  });

  it("describes an evidence item's at, locator and iri", () => {
    const [found] = openOutputWith(trust).options;

    expect(described(found.shape.concept.unwrap().shape.evidence.element.shape)).toMatchObject({
      at: true,
      locator: true,
      iri: true,
    });
  });

  it.each([
    ["no concept and no passage", {}],
    [
      "a concept and a passage",
      {
        concept: {
          iri: "https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ",
          frontmatter: { title: "Kingfisher policy", type: "Policy" },
          body: "The kingfisher rule is stated here.",
          relations: [],
          trust: unverified,
          trustWords: "Unverified",
          evidence: [],
        },
        passage: {
          locator: "01J6ZZZZZZZZZZZZZZZZZZZZZZ/chars:0-44",
          source: "The bid library's invoice",
          text: "The kingfisher invoice was settled in March.",
          sensitivity: "Internal",
        },
      },
    ],
  ])("refuses a found result of %s", (_case, held) => {
    const refused = openOutputWith(trust).safeParse({ found: true, ...held });

    expect(refused.success).toBe(false);
    expect(messagesOf(refused)).toEqual([
      "a found result carries a concept or a passage, never both or neither",
    ]);
  });
});

describe("the two knowledge layers a search and a fetch reach", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  const QUERY = "kingfisher";

  const INVOICE_TITLE = "The bid library's invoice";
  const INVOICE_TEXT = "The kingfisher invoice was settled in March.";
  const HANDBOOK_TITLE = "The covered handbook";
  const HANDBOOK_TEXT = "The kingfisher handbook explains the rule.";
  const CONCEPT_TITLE = "Kingfisher policy";
  const CONCEPT_BODY = "The kingfisher rule is stated here.";

  const documentHolding = (workspaceId: string, shape: DocumentShape): Promise<LandedDocument> =>
    documentLanded(db().pool, workspaceId, shape);

  const conceptResting = async (
    workspaceId: string,
    document: LandedDocument,
  ): Promise<ConceptIri> => {
    const client = await db().pool.connect();
    try {
      const seed = testData(client);
      const indexed = await seed.conceptIndex({
        workspaceId,
        kind: "Policy",
        title: CONCEPT_TITLE,
        body: CONCEPT_BODY,
        frontmatter: {
          title: CONCEPT_TITLE,
          type: "Policy",
          sources: [{ resource: HANDBOOK_TITLE, locator: document.locator, title: HANDBOOK_TITLE }],
        },
        publishedAt: PUBLISHED_AT,
        sensitivity: "Internal",
      });
      await seed.evidence({
        workspaceId,
        sourceDocumentId: document.documentId,
        locator: document.locator,
        resource: HANDBOOK_TITLE,
      });
      await seed.conceptEvidence({
        workspaceId,
        iri: indexed.iri,
        sourceDocumentId: document.documentId,
        locator: document.locator,
      });
      return indexed.iri;
    } finally {
      client.release();
    }
  };

  /**
   * A Policy naming a passage of `handbook`, a page and a second concept as its sources, with a
   * map edge to that concept.
   */
  const conceptOfThreeSources = async (
    workspaceId: string,
    handbook: LandedDocument,
  ): Promise<{ readonly iri: ConceptIri; readonly cited: ConceptIri }> => {
    const client = await db().pool.connect();
    try {
      const seed = testData(client);
      const cited = await seed.conceptIndex({
        workspaceId,
        kind: "Policy",
        title: "Travel policy",
        publishedAt: PUBLISHED_AT,
        sensitivity: "Internal",
      });
      const indexed = await seed.conceptIndex({
        workspaceId,
        kind: "Policy",
        title: CONCEPT_TITLE,
        body: CONCEPT_BODY,
        frontmatter: {
          title: CONCEPT_TITLE,
          type: "Policy",
          sources: [
            {
              id: "S-1",
              title: HANDBOOK_TITLE,
              resource: "documents/handbook",
              locator: handbook.locator,
            },
            { title: "Bid library", resource: "../sources/bid-library.md", locator: "p.4" },
            { title: "Travel policy", resource: cited.iri },
          ],
        },
        publishedAt: PUBLISHED_AT,
        sensitivity: "Internal",
      });
      await seed.mapEdge({
        workspaceId,
        label: "CITES",
        fromUid: indexed.iri,
        toUid: cited.iri,
      });
      return { iri: indexed.iri, cited: cited.iri };
    } finally {
      client.release();
    }
  };

  const searching = (reader: Awaited<ReturnType<typeof arrange>>, limit = 10) =>
    acting(reader, (principal, tx) => find(principal, tx, { query: QUERY, limit }, now));

  const opening = (reader: Awaited<ReturnType<typeof arrange>>, locator: string) =>
    acting(reader, (principal, tx) => open(principal, tx, { locator }, now));

  const aDocumentEachWay = async (reader: Awaited<ReturnType<typeof arrange>>) => {
    const invoice = await documentHolding(reader.workspaceId, {
      title: INVOICE_TITLE,
      text: INVOICE_TEXT,
    });
    const handbook = await documentHolding(reader.workspaceId, {
      title: HANDBOOK_TITLE,
      text: HANDBOOK_TEXT,
    });
    return { invoice, handbook, iri: await conceptResting(reader.workspaceId, handbook) };
  };

  it("previews a document marked not company knowledge, beside the concept", async () => {
    const reader = await arrange();
    const { invoice, iri } = await aDocumentEachWay(reader);

    const found = await searching(reader);

    expect(found).toEqual({
      ok: true,
      value: {
        query: QUERY,
        matches: [
          {
            layer: "bundles",
            iri,
            kind: "Policy",
            title: CONCEPT_TITLE,
            trust: unverified,
            trustWords: "Unverified",
            bundle: "knowledge",
            tags: [],
          },
          {
            layer: "sources",
            kind: "document",
            title: INVOICE_TITLE,
            locator: invoice.locator,
            sensitivity: "Internal",
          },
        ],
      },
    });
    expect(found.ok && renderFind(found.value)).toBe(
      [
        `Policy · ${CONCEPT_TITLE} · Unverified · ${iri}`,
        `document · ${INVOICE_TITLE} · ${NOT_COMPANY_KNOWLEDGE} · Internal · ${invoice.locator}`,
      ].join("\n"),
    );
  });

  it("caps matches at the limit across both layers, concepts first", async () => {
    const reader = await arrange();
    const { invoice, iri } = await aDocumentEachWay(reader);

    const [ofOne, ofTwo] = await Promise.all([searching(reader, 1), searching(reader, 2)]);

    expect(ofOne.ok && ofOne.value.matches).toEqual([
      expect.objectContaining({ layer: "bundles", iri }),
    ]);
    expect(ofTwo.ok && ofTwo.value.matches).toEqual([
      expect.objectContaining({ layer: "bundles", iri }),
      expect.objectContaining({ layer: "sources", locator: invoice.locator }),
    ]);
  });

  it("opens a match's passage with its document and sensitivity word", async () => {
    const reader = await arrange();
    const invoice = await documentHolding(reader.workspaceId, {
      title: INVOICE_TITLE,
      text: INVOICE_TEXT,
    });

    const opened = await opening(reader, invoice.locator);

    expect(opened).toEqual({
      ok: true,
      value: {
        found: true,
        passage: {
          locator: invoice.locator,
          source: INVOICE_TITLE,
          text: "The kingfisher invoice was settled in March.",
          sensitivity: "Internal",
        },
      },
    });
    expect(opened.ok && renderOpen(opened.value)).toBe(
      [
        "> The kingfisher invoice was settled in March.",
        "",
        `— ${INVOICE_TITLE} (${invoice.locator}) · Internal`,
      ].join("\n"),
    );
  });

  it("answers withheld, unpublished, malformed and out-of-range locators as not found", async () => {
    const reader = await arrange();
    const visible = await documentHolding(reader.workspaceId, {
      title: INVOICE_TITLE,
      text: INVOICE_TEXT,
    });
    const unpublished = await documentHolding(reader.workspaceId, {
      title: "The connected source still under review",
      text: HANDBOOK_TEXT,
      publishedAt: null,
    });

    const groupId = await groupSeeded(db().pool, reader.workspaceId);
    const elsewhere = await documentHolding(reader.workspaceId, {
      title: "The bid team's own file",
      text: HANDBOOK_TEXT,
      audienceGroups: [groupId],
    });

    const pastTheEnd = `${visible.documentId}/chars:0-${codePointsOf(INVOICE_TEXT) + 1}`;

    const [underReview, outsideTheAudience, nonsense, tooFar, found] = await Promise.all([
      opening(reader, unpublished.locator),
      opening(reader, elsewhere.locator),
      opening(reader, "not an address at all"),
      opening(reader, pastTheEnd),
      searching(reader),
    ]);

    expect(underReview).toEqual({
      ok: true,
      value: { found: false, locator: unpublished.locator },
    });
    expect(outsideTheAudience).toEqual({
      ok: true,
      value: { found: false, locator: elsewhere.locator },
    });
    expect(nonsense).toEqual({
      ok: true,
      value: { found: false, locator: "not an address at all" },
    });
    expect(tooFar).toEqual({ ok: true, value: { found: false, locator: pastTheEnd } });

    expect(found.ok && found.value.matches).toEqual([
      {
        layer: "sources",
        kind: "document",
        title: INVOICE_TITLE,
        locator: visible.locator,
        sensitivity: "Internal",
      },
    ]);
  });

  it("renders an opened concept's evidence locators, each opening its passage", async () => {
    const reader = await arrange();
    const handbook = await documentHolding(reader.workspaceId, {
      title: HANDBOOK_TITLE,
      text: HANDBOOK_TEXT,
    });
    const iri = await conceptResting(reader.workspaceId, handbook);

    const concept = await acting(reader, (principal, tx) => open(principal, tx, { iri }, now));

    expect(concept.ok && concept.value.found && concept.value.concept?.evidence).toEqual([
      { locator: handbook.locator, source: HANDBOOK_TITLE },
    ]);
    expect(concept.ok && renderOpen(concept.value)).toContain(
      `- ${HANDBOOK_TITLE} (${handbook.locator})`,
    );

    const passage = await opening(reader, handbook.locator);

    expect(passage).toEqual({
      ok: true,
      value: {
        found: true,
        passage: {
          locator: handbook.locator,
          source: HANDBOOK_TITLE,
          text: "The kingfisher handbook explains the rule.",
          sensitivity: "Internal",
        },
      },
    });
  });

  it("keeps a two-layer search whole through find's output schema", async () => {
    const reader = await arrange();
    const { invoice, iri } = await aDocumentEachWay(reader);

    const found = await searching(reader);

    expect(findOutputWith(trust).safeParse(found.ok && found.value)).toEqual({
      success: true,
      data: {
        query: "kingfisher",
        matches: [
          {
            layer: "bundles",
            iri,
            kind: "Policy",
            title: "Kingfisher policy",
            trust: unverified,
            trustWords: "Unverified",
            bundle: "knowledge",
            tags: [],
          },
          {
            layer: "sources",
            kind: "document",
            title: "The bid library's invoice",
            locator: invoice.locator,
            sensitivity: "Internal",
          },
        ],
      },
    });
  });

  it("drops only the pane's words from an opened concept", async () => {
    const reader = await arrange();
    const handbook = await documentHolding(reader.workspaceId, {
      title: HANDBOOK_TITLE,
      text: HANDBOOK_TEXT,
    });
    const { iri, cited } = await conceptOfThreeSources(reader.workspaceId, handbook);

    const opened = await acting(reader, (principal, tx) => open(principal, tx, { iri }, now));

    expect(opened.ok && opened.value.found && opened.value.concept).toMatchObject({
      access: "included",
      lead: "Based on your current access, the evidence is included.",
      next: "Open a source to read the passage the concept rests on.",
    });
    expect(openOutputWith(trust).safeParse(opened.ok && opened.value)).toEqual({
      success: true,
      data: {
        found: true,
        concept: {
          iri,
          frontmatter: {
            title: "Kingfisher policy",
            type: "Policy",
            sources: [
              {
                id: "S-1",
                title: "The covered handbook",
                resource: "documents/handbook",
                locator: handbook.locator,
              },
              { title: "Bid library", resource: "Bid library", locator: "p.4" },
              { title: "Travel policy", resource: cited },
            ],
          },
          body: "The kingfisher rule is stated here.",
          relations: [{ kind: "CITES", target: cited, title: "Travel policy" }],
          trust: unverified,
          trustWords: "Unverified",
          evidence: [
            { id: "S-1", source: "The covered handbook", locator: handbook.locator },
            { source: "Bid library", at: "p.4" },
            { source: "Travel policy", iri: cited },
          ],
        },
      },
    });
  });

  it("keeps an opened passage and both not-found answers whole", async () => {
    const reader = await arrange();
    const invoice = await documentHolding(reader.workspaceId, {
      title: INVOICE_TITLE,
      text: INVOICE_TEXT,
    });

    const [passage, noPassage, noConcept] = await Promise.all([
      opening(reader, invoice.locator),
      opening(reader, "not an address at all"),
      acting(reader, (principal, tx) => open(principal, tx, { iri: ABSENT }, now)),
    ]);

    expect(openOutputWith(trust).safeParse(passage.ok && passage.value)).toEqual({
      success: true,
      data: {
        found: true,
        passage: {
          locator: invoice.locator,
          source: "The bid library's invoice",
          text: "The kingfisher invoice was settled in March.",
          sensitivity: "Internal",
        },
      },
    });
    expect(openOutputWith(trust).safeParse(noPassage.ok && noPassage.value)).toEqual({
      success: true,
      data: { found: false, locator: "not an address at all" },
    });
    expect(openOutputWith(trust).safeParse(noConcept.ok && noConcept.value)).toEqual({
      success: true,
      data: { found: false, iri: "https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ" },
    });
  });
});
