import { testData } from "@better-answers/schema/testing";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ask,
  find,
  giveFeedback,
  mapWords,
  NOT_ANSWERED,
  NOT_COMPANY_KNOWLEDGE,
  open,
  renderAnswer,
  renderFeedback,
  renderFind,
  renderOpen,
  trustWords,
  type AnswerResult,
  type FeedbackReason,
  type FeedbackReceipt,
  type FindResult,
  type OpenResult,
  type Trust,
} from "../src/answering/index.ts";
import type { Result, UserPrincipal } from "../src/kernel/index.ts";
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

const arrange = async (): Promise<{ readonly workspaceId: string; readonly userId: string }> => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const workspace = await seed.workspace();
    const member = await seed.member({ workspaceId: workspace.id, role: "Viewer" });
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

const unchecked: Trust = {
  tier: "unverified",
  status: "current",
  checkedBy: null,
  checkedAt: null,
  rider: null,
};

describe("the trust words", () => {
  it("names a current unit's tier, checker, date and any rider", () => {
    expect(
      trustWords({
        tier: "human-reviewed",
        status: "current",
        checkedBy: "Priya Shah",
        checkedAt: "2026-03-03",
        rider: null,
      }),
    ).toBe("Checked by Priya Shah · 3 March 2026");
    expect(
      trustWords({
        tier: "human-reviewed",
        status: "current",
        checkedBy: "Priya Shah",
        checkedAt: "2026-03-03",
        rider: "imported",
      }),
    ).toBe("Checked by Priya Shah · 3 March 2026 · imported");
    expect(
      trustWords({
        tier: "machine-confirmed",
        status: "current",
        checkedBy: null,
        checkedAt: null,
        rider: "source-moved-on",
      }),
    ).toBe("Checked by the platform · source moved on");
    expect(trustWords(unchecked)).toBe("Unchecked");
  });

  it("says a person checked, omitting a missing name or date", () => {
    expect(
      trustWords({
        tier: "human-reviewed",
        status: "current",
        checkedBy: "Priya Shah",
        checkedAt: null,
        rider: null,
      }),
    ).toBe("Checked by Priya Shah");
    expect(
      trustWords({
        tier: "human-reviewed",
        status: "current",
        checkedBy: null,
        checkedAt: null,
        rider: null,
      }),
    ).toBe("Checked by a person");
  });

  it("shows an unreadable date as the file wrote it", () => {
    expect(
      trustWords({
        tier: "human-reviewed",
        status: "current",
        checkedBy: "Priya Shah",
        checkedAt: "when the contract ends",
        rider: null,
      }),
    ).toBe("Checked by Priya Shah · when the contract ends");
    expect(mapWords({ state: "as_of", at: "when the contract ends" })).toBe(
      "map as of when the contract ends",
    );
  });

  it("names any status but current, whatever the tier", () => {
    const base = {
      tier: "human-reviewed" as const,
      checkedBy: "A",
      checkedAt: "2026-01-01",
      rider: null,
    };
    expect(trustWords({ ...base, status: "changed-since-checked" })).toBe("Changed since checked");
    expect(trustWords({ ...base, status: "out-of-date" })).toBe("Out of date");
    expect(trustWords({ ...base, status: "draft" })).toBe("Draft");
    expect(trustWords({ ...base, status: "deprecated" })).toBe("Deprecated");
  });
});

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
  it("says nothing matches without hits, else one line per hit", () => {
    expect(renderFind({ query: "expenses", hits: [] })).toBe(
      "Nothing in the company's knowledge matches that.",
    );
    expect(
      renderFind({
        query: "expenses",
        hits: [
          {
            layer: "bundles",
            iri: "https://better-answers.com/c/01A",
            kind: "Policy",
            title: "Expenses",
            trust: unchecked,
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
              checkedBy: "Priya Shah",
              checkedAt: "2026-03-03",
              rider: null,
            },
            bundle: "acme",
            tags: ["travel"],
          },
        ],
      }),
    ).toBe(
      [
        "Policy · Expenses · Unchecked · https://better-answers.com/c/01A",
        "Guide · Travel · Checked by Priya Shah · 3 March 2026 · https://better-answers.com/c/01B",
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
          trust: unchecked,
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
        "_Unchecked_",
        "",
        "Evidence:",
        "- Handbook (p.4)",
        "- Travel policy (p.9)",
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
            checkedBy: "Priya Shah",
            checkedAt: "2026-03-03",
            rider: null,
          },
          evidence: [],
        },
      }),
    ).toBe(
      [
        "# https://better-answers.com/c/01B",
        "",
        "Travel is booked in advance.",
        "",
        "_Checked by Priya Shah · 3 March 2026_",
      ].join("\n"),
    );
  });

  it("names what was asked where there is nothing to show", () => {
    expect(renderOpen({ found: false, iri: "https://better-answers.com/c/01C" })).toBe(
      "No concept at https://better-answers.com/c/01C.",
    );

    expect(renderOpen({ found: false })).toBe("No passage at that locator.");
    expect(renderOpen({ found: true })).toBe("Nothing to show.");
  });

  it("renders feedback and each flag reason in words, not tokens", () => {
    const iri = "https://better-answers.com/c/01A";
    const received = (what: string): string =>
      `Received: ${iri} marked ${what}. It reaches the owner's queue when the Suggestions screen ships.`;
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

describe("what the slice's four acts answer", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("hands every caller an outcome to read, not to catch", () => {
    expectTypeOf(find).returns.resolves.toEqualTypeOf<Result<FindResult, Error>>();
    expectTypeOf(open).returns.resolves.toEqualTypeOf<Result<OpenResult, Error>>();
    expectTypeOf(ask).returns.resolves.toEqualTypeOf<Result<AnswerResult, Error>>();
    expectTypeOf(giveFeedback).returns.resolves.toEqualTypeOf<Result<FeedbackReceipt, never>>();
  });

  it("answers the query and no hits where neither arm matches", async () => {
    const reader = await arrange();

    const found = await acting(reader, (principal, tx) =>
      find(principal, tx, { query: "expenses", limit: 10 }, now),
    );

    expect(found).toEqual({ ok: true, value: { query: "expenses", hits: [] } });
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
        answered = await open(principal, tx, { iri: "https://better-answers.com/c/01A" }, now);
      }),
    ).rejects.toThrow("the transaction did not commit");

    expect(answered?.ok).toBe(false);
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

  const conceptResting = async (workspaceId: string, document: LandedDocument): Promise<string> => {
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
        hits: [
          {
            layer: "bundles",
            iri,
            kind: "Policy",
            title: CONCEPT_TITLE,
            trust: unchecked,
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
        `Policy · ${CONCEPT_TITLE} · Unchecked · ${iri}`,
        `document · ${INVOICE_TITLE} · ${NOT_COMPANY_KNOWLEDGE} · Internal · ${invoice.locator}`,
      ].join("\n"),
    );
  });

  it("caps hits at the limit across both layers, concepts first", async () => {
    const reader = await arrange();
    const { invoice, iri } = await aDocumentEachWay(reader);

    const [ofOne, ofTwo] = await Promise.all([searching(reader, 1), searching(reader, 2)]);

    expect(ofOne.ok && ofOne.value.hits).toEqual([
      expect.objectContaining({ layer: "bundles", iri }),
    ]);
    expect(ofTwo.ok && ofTwo.value.hits).toEqual([
      expect.objectContaining({ layer: "bundles", iri }),
      expect.objectContaining({ layer: "sources", locator: invoice.locator }),
    ]);
  });

  it("opens a hit's passage with its document and sensitivity word", async () => {
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
      title: "The binding still under review",
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

    expect(found.ok && found.value.hits).toEqual([
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
});
