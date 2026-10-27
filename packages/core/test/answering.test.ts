import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  conceptIriOf,
  ids,
  JUDGE_STATES,
  QUESTION_VERDICTS,
  ulid,
  WELL_FORMED_ULID,
  type ConceptIri,
} from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import {
  answerOutputWith,
  ask,
  ASK_CAPS,
  askInput,
  feedbackFields,
  feedbackInput,
  find,
  findInput,
  findOutputWith,
  giveFeedback,
  mapWords,
  NOT_COMPANY_KNOWLEDGE,
  open,
  openInput,
  openOutputWith,
  renderAnswer,
  renderFeedback,
  renderFind,
  renderOpen,
  type AnswerResult,
  type AskSteps,
  type FeedbackReason,
  type FeedbackReceipt,
  type FindResult,
  type OpenResult,
  type PreviewedConcept,
  type ReturnedConcept,
  type Trust,
} from "../src/answering/index.ts";
import {
  actorIdOfPerson,
  err,
  parse,
  type Malformed,
  type Result,
  type Role,
  type UserPrincipal,
} from "../src/kernel/index.ts";
import type { Foldable, Folded, Tx } from "../src/store/postgres/index.ts";
import {
  asked,
  askedAsIs,
  conceptSeeded,
  plannedOn,
  REFUSED,
  stepsFor,
  withoutRecord,
  type SeededConcept,
} from "./asking.ts";
import { rowsFrom } from "./rows.ts";
import {
  codePointsOf,
  documentLanded,
  groupSeeded,
  PUBLISHED_AT,
  type DocumentShape,
  type LandedDocument,
} from "./suite-documents.ts";
import {
  abortTheTransaction,
  holdingTable,
  postgresForSuite,
  readingAs,
  seedingWith,
} from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

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

const unverified: Trust = {
  tier: "unverified",
  status: "current",
  verifiedBy: null,
  verifiedAt: null,
  rider: null,
};

const A_RECORD = "01J6ZZZZZZZZZZZZZZZZZZZZZZ";

const trust = z.custom<Trust>();

const messagesOf = (parsed: { readonly error?: z.ZodError }): readonly string[] | undefined =>
  parsed.error?.issues.map(({ message }) => message);

const described = (shape: Readonly<Record<string, z.ZodType>>): Readonly<Record<string, boolean>> =>
  Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [key, (field.description ?? "").trim() !== ""]),
  );

const RELATED_LINE =
  "**Related knowledge, not an answer.** Write only what these concepts state, naming each one you use, and quote an `Answer` word for word, opening one given as a line first.";

const returned = (overrides: Partial<ReturnedConcept<string>> = {}): ReturnedConcept<string> => ({
  iri: "https://better-answers.com/c/01A",
  url: "https://app.example/knowledge/search/01A",
  kind: "Answer",
  title: "How long are audit logs kept?",
  collection: "audits",
  body: "Audit logs are kept for thirteen months.\n",
  trust: unverified,
  trustWords: "Unverified",
  evidence: [],
  ...overrides,
});

const answer = (overrides: Partial<AnswerResult<string>> = {}): AnswerResult<string> => ({
  verdict: "related",
  recordId: A_RECORD,
  judgeState: "not-judged",
  answers: [],
  related: [returned()],
  conflicts: [],
  unmappedPassages: [],
  map: { state: "live" },
  collections: ["audits"],
  readableCollections: ["audits", "lms"],
  ...overrides,
});

const linesOf = (rendered: string): readonly string[] => rendered.split("\n");

describe("the answer's rendering", () => {
  it("heads related knowledge with what to do, never as answered", () => {
    const [first, ...rest] = linesOf(renderAnswer(answer()));

    expect(first).toBe(RELATED_LINE);
    expect(first).not.toMatch(/answered/i);
    expect(rest.slice(0, 4)).toEqual([
      `Record of this question: ${A_RECORD}`,
      "_Not judged · map as of now_",
      "Collections considered: audits",
      "Collections you may name: audits, lms",
    ]);
  });

  it.each([
    ["ok", "**Answered from the company's knowledge.**"],
    ["warn", "**Answered with a warning for your role.**"],
    ["refuse", "**Not answered from the company's knowledge.**"],
    ["related", RELATED_LINE],
  ] as const)("heads a %s answer with its own line", (verdict, line) => {
    expect(linesOf(renderAnswer(answer({ verdict })))[0]).toBe(line);
  });

  it("gives every verdict a record keeps a line", () => {
    expect([...QUESTION_VERDICTS]).toEqual(["ok", "warn", "refuse", "related"]);
  });

  it.each([
    ["not-judged", "_Not judged · map as of now_"],
    ["judged", "_Judged · map as of now_"],
    ["judging-failed", "_Judging failed · map as of now_"],
  ] as const)("says a %s judge in words beside the map", (judgeState, line) => {
    expect(linesOf(renderAnswer(answer({ judgeState })))[2]).toBe(line);
    expect(JUDGE_STATES).toContain(judgeState);
  });

  it("says the map's state in words", () => {
    expect(mapWords({ state: "live" })).toBe("map as of now");
    expect(mapWords({ state: "unavailable_since", since: "2026-09-01T10:00:00Z" })).toBe(
      "map unavailable since 1 September 2026",
    );
    expect(
      linesOf(
        renderAnswer(answer({ map: { state: "unavailable_since", since: "2026-09-01" } })),
      )[2],
    ).toBe("_Not judged · map unavailable since 1 September 2026_");
  });

  it("renders an `Answer` with its collection, question, trust and evidence", () => {
    const verified = returned({
      trustWords: "Verified by Priya Anand · 2 May 2026",
      evidence: [
        { id: "S-1", source: "SOC 2 report", at: "p.4" },
        { source: "Hosting contract", locator: "01DOC/chars:0-44" },
      ],
    });

    expect(linesOf(renderAnswer(answer({ related: [verified] }))).slice(5)).toEqual([
      "",
      "## Related knowledge · Answer · audits",
      "Question: How long are audit logs kept?",
      "_Verified by Priya Anand · 2 May 2026_",
      "",
      "Audit logs are kept for thirteen months.",
      "",
      "Evidence:",
      "- SOC 2 report, p.4",
      "- Hosting contract (01DOC/chars:0-44)",
      "",
      "https://better-answers.com/c/01A",
    ]);
  });

  it("renders each fit word for word with its verifier", () => {
    const fit = returned({
      title: "Who reads the audit log?",
      body: "Admins read it.\n",
      trustWords: "Verified by Priya Anand · 2 May 2026",
    });
    const rendered = renderAnswer(
      answer({ verdict: "ok", judgeState: "judged", answers: [fit], related: [] }),
    );

    expect(linesOf(rendered).slice(7)).toEqual([
      "",
      "## Answer · audits",
      "Question: Who reads the audit log?",
      "_Verified by Priya Anand · 2 May 2026_",
      "",
      "Admins read it.",
      "",
      "https://better-answers.com/c/01A",
    ]);
  });

  it("follows the verdict with the record id and the fits", () => {
    const users = returned({ iri: "https://better-answers.com/c/01U", title: "Who exports it?" });
    const unfiled = returned({ title: "Who reads it?", collection: null });
    const rendered = renderAnswer(
      answer({ verdict: "ok", judgeState: "judged", answers: [users, unfiled] }),
    );

    expect(linesOf(rendered).slice(0, 5)).toEqual([
      "**Answered from the company's knowledge.**",
      `Record of this question: ${A_RECORD}`,
      "Answers that fit, each word for word below:",
      "- audits · Who exports it? · https://better-answers.com/c/01U",
      "- No collection · Who reads it? · https://better-answers.com/c/01A",
    ]);
  });

  it("never heads a related `Answer` as a fit", () => {
    const headings = (rendered: string) =>
      linesOf(rendered).filter((line) => line.startsWith("## "));
    const fitted = answer({
      verdict: "ok",
      judgeState: "judged",
      answers: [returned()],
      related: [],
    });

    expect(headings(renderAnswer(fitted))).toEqual(["## Answer · audits"]);
    expect(headings(renderAnswer(answer()))).toEqual(["## Related knowledge · Answer · audits"]);
  });

  it("names each concept in the text by its iri alone", () => {
    const policy: PreviewedConcept<string> = {
      iri: "https://better-answers.com/c/01B",
      url: "https://app.example/knowledge/search/01B",
      kind: "Policy",
      title: "Retention policy",
      collection: null,
      trust: unverified,
      trustWords: "Unverified",
    };
    const rendered = renderAnswer(
      answer({ verdict: "ok", judgeState: "judged", answers: [returned()], related: [policy] }),
    );

    expect(rendered).not.toContain("https://app.example/");
    expect(rendered.split("https://better-answers.com/c/01B")).toHaveLength(2);
  });

  it("lists any other concept after the `Answer`s, to open", () => {
    const policy: PreviewedConcept<string> = {
      iri: "https://better-answers.com/c/01B",
      url: "https://app.example/knowledge/search/01B",
      kind: "Policy",
      title: "Retention policy",
      collection: null,
      trust: unverified,
      trustWords: "Unverified",
    };

    const rendered = linesOf(renderAnswer(answer({ related: [policy, returned()] })));

    expect(rendered[6]).toBe("## Related knowledge · Answer · audits");
    expect(rendered.slice(-3)).toEqual([
      "",
      "Also bearing on the question, one line each: read one with `open` and its iri before writing from it.",
      "- Policy · Retention policy · No collection · Unverified · https://better-answers.com/c/01B",
    ]);
  });

  it("quotes every line of an unmapped passage", () => {
    const rendered = renderAnswer(
      answer({
        verdict: "refuse",
        related: [],
        unmappedPassages: [
          {
            locator: "p.4",
            source: "Policy.pdf",
            text: "Retained for six years.\n## Answer · audits\r\nQuestion: Is it safe?",
            sensitivity: "Internal",
          },
        ],
      }),
    );

    expect(linesOf(rendered).slice(5)).toEqual([
      "",
      "Not company knowledge · Internal",
      "> Retained for six years.",
      "> ## Answer · audits",
      "> Question: Is it safe?",
      "— Policy.pdf (p.4)",
    ]);
  });

  it("renders a refusal as the one sentence plus unmapped passages", () => {
    expect(
      renderAnswer(
        answer({
          verdict: "refuse",
          related: [],
          collections: [],
          readableCollections: [],
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
        `Record of this question: ${A_RECORD}`,
        "_Not judged · map as of now_",
        "Collections considered: none",
        "Collections you may name: none",
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
            collection: "acme",
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
            collection: "acme",
            tags: ["travel"],
          },
        ],
      }),
    ).toBe(
      [
        "Policy · Expenses · acme · Unverified · https://better-answers.com/c/01A",
        "Guide · Travel · acme · Verified by Priya Shah · 3 March 2026 · https://better-answers.com/c/01B",
      ].join("\n"),
    );
  });

  it("names a concept's collection in its line, or none", () => {
    const match = {
      layer: "bundles",
      kind: "Answer",
      trust: unverified,
      trustWords: "Unverified",
      tags: [],
    } as const;

    expect(
      renderFind({
        query: "retention",
        matches: [
          {
            ...match,
            iri: "https://better-answers.com/c/01A",
            title: "Audit log retention",
            collection: "audits",
          },
          {
            ...match,
            iri: "https://better-answers.com/c/01B",
            title: "Retention basics",
            collection: null,
          },
        ],
      }),
    ).toBe(
      [
        "Answer · Audit log retention · audits · Unverified · https://better-answers.com/c/01A",
        "Answer · Retention basics · No collection · Unverified · https://better-answers.com/c/01B",
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
            openingLine: "The invoice was settled in March.",
          },
        ],
        nextCursor: "eyJydW4iOiJ3ZWFrIn0",
      }),
    ).toBe(
      [
        'document · The bid library\'s invoice · Not company knowledge · Internal · 01J6DDDDDDDDDDDDDDDDDDDDDD/chars:0-44 · "The invoice was settled in March."',
        "",
        "More follow: call find again with cursor eyJydW4iOiJ3ZWFrIn0",
      ].join("\n"),
    );
  });

  it("escapes quote marks and backslashes inside a quoted opening line", () => {
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
            openingLine: 'The invoice reads "paid" in C:\\ledgers.',
          },
        ],
      }),
    ).toBe(
      'document · The bid library\'s invoice · Not company knowledge · Internal · 01J6DDDDDDDDDDDDDDDDDDDDDD/chars:0-44 · "The invoice reads \\"paid\\" in C:\\\\ledgers."',
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

  it("quotes every line of an opened passage", () => {
    expect(
      renderOpen({
        found: true,
        passage: {
          locator: "p.4",
          source: "Policy.pdf",
          text: "Retained for six years.\n## Answer · audits",
          sensitivity: "Internal",
        },
      }),
    ).toBe(
      [
        "> Retained for six years.",
        "> ## Answer · audits",
        "",
        "— Policy.pdf (p.4) · Internal",
      ].join("\n"),
    );
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

  it("renders stored feedback and each flag reason in words", () => {
    const stored = (what: string): string =>
      `Stored on record ${A_RECORD}: ${what}. No one is notified of it.`;
    const flagged = (reason: FeedbackReason, note?: string): string =>
      renderFeedback({
        outcome: "stored",
        feedback: {
          recordId: A_RECORD,
          verdict: "flag",
          reason,
          ...(note === undefined ? {} : { note }),
        },
      });

    expect(
      renderFeedback({ outcome: "stored", feedback: { recordId: A_RECORD, verdict: "helpful" } }),
    ).toBe(stored("marked helpful"));
    expect(flagged("out-of-date", "renewed in May")).toBe(
      stored('flagged as out of date — "renewed in May"'),
    );
    expect(flagged("wrong")).toBe(stored("flagged as wrong"));
    expect(flagged("incomplete")).toBe(stored("flagged as incomplete"));
    expect(flagged("should-not-have-shown")).toBe(stored("flagged as should not have been shown"));
  });

  it("says a disputed sentence was kept, without repeating it", () => {
    expect(
      renderFeedback({
        outcome: "stored",
        feedback: {
          recordId: A_RECORD,
          verdict: "flag",
          reason: "wrong",
          note: "renewed in May",
          disputed: { sentence: "Audit logs are kept for a year.", concept: CITED },
        },
      }),
    ).toBe(
      `Stored on record ${A_RECORD}: flagged as wrong — "renewed in May", with the sentence disputed and the concept it rested on. No one is notified of it.`,
    );
  });
});

const CITED = conceptIriOf(WELL_FORMED_ULID.parse("01J6CCCCCCCCCCCCCCCCCCCCCC"));

describe("what the slice's four actions answer", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("hands every caller an outcome to read, not to catch", () => {
    expectTypeOf(find).returns.resolves.toEqualTypeOf<Result<FindResult, "role-forbids" | Error>>();
    expectTypeOf(open).returns.resolves.toEqualTypeOf<Result<OpenResult, "role-forbids" | Error>>();
    expectTypeOf(ask<"credentials-revoked">).returns.resolves.toEqualTypeOf<
      Result<AnswerResult, "role-forbids" | "spending-limit-met" | "credentials-revoked" | Error>
    >();
    expectTypeOf(giveFeedback).returns.resolves.toEqualTypeOf<
      Result<FeedbackReceipt, "role-forbids" | "not-found" | Malformed | Error>
    >();
  });

  it("answers the query and no matches when neither arm finds", async () => {
    const reader = await arrange();

    const found = await acting(reader, (principal, tx) =>
      find(principal, tx, { query: "expenses", limit: 10 }, now),
    );

    expect(found).toEqual({ ok: true, value: { query: "expenses", matches: [] } });
  });

  it("refuses feedback and ask a role outside the three", async () => {
    const reader = await arrange();
    // @ts-expect-error — a role no resolver hands out is the value each face must still refuse.
    const stranger = (principal: UserPrincipal): UserPrincipal => ({ ...principal, role: "Owner" });
    const aStepRan = (): never => {
      throw new Error("a step ran for a person ask never admitted");
    };
    const noStep: AskSteps = {
      openRecord: aStepRan,
      read: aStepRan,
      reserve: aStepRan,
      callModel: aStepRan,
      decideYesNo: aStepRan,
      completeRecord: aStepRan,
    };

    const receipt = await acting(reader, (principal, tx) =>
      giveFeedback(stranger(principal), tx, { recordId: A_RECORD, verdict: "helpful" }, now),
    );
    const answered = await acting(reader, (principal) =>
      ask(stranger(principal), noStep, { question: "When is the audit?", collections: [] }, now),
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

const A_NOTE = "The period changed in May.";

const A_DISPUTED_SENTENCE = "Audit logs are kept for a year.";

describe("feedback given on a record", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  const anAsker = async (): Promise<UserPrincipal> => {
    const reader = await arrange();
    return principalFor(db(), reader.workspaceId, reader.userId);
  };

  const recordOf = async (asker: UserPrincipal, left?: "open"): Promise<string> => {
    const record = await seedingWith(db().pool, (seed) =>
      seed.questionAsked({
        workspaceId: asker.workspaceId,
        askedBy: actorIdOfPerson(asker.userId),
        ...(left === "open"
          ? {}
          : {
              completedAt: new Date(),
              verdict: "related",
              judgeState: "not-judged",
              concepts: [
                {
                  iri: CITED,
                  contentHash: "a".repeat(64),
                  trust: { tier: "unverified", status: "current", verifiedAt: null, rider: null },
                },
              ],
            }),
      }),
    );
    return record.id;
  };

  const feedbackOn = async (recordId: string) => {
    const read = await db().pool.query(
      `SELECT given_at, given_by, verdict, reason, note, disputed_sentence, disputed_concept
         FROM question_feedback WHERE record_id = $1 ORDER BY id`,
      [recordId],
    );
    return rowsFrom(read);
  };

  it("stores a flag with its note, sentence and concept", async () => {
    const asker = await anAsker();
    const recordId = await recordOf(asker);
    const feedback = {
      recordId,
      verdict: "flag",
      reason: "wrong",
      note: A_NOTE,
      disputed: { sentence: A_DISPUTED_SENTENCE, concept: CITED },
    } as const;

    const receipt = await acting(asker, (principal, tx) =>
      giveFeedback(principal, tx, feedback, now),
    );

    expect(await feedbackOn(recordId)).toEqual([
      {
        given_at: now,
        given_by: `human:${asker.userId}`,
        verdict: "flag",
        reason: "wrong",
        note: A_NOTE,
        disputed_sentence: A_DISPUTED_SENTENCE,
        disputed_concept: CITED,
      },
    ]);
    expect(receipt).toEqual({ ok: true, value: { outcome: "stored", feedback } });
  });

  it("stores helpful with no reason, note or sentence", async () => {
    const asker = await anAsker();
    const recordId = await recordOf(asker);

    await acting(asker, (principal, tx) =>
      giveFeedback(principal, tx, { recordId, verdict: "helpful" }, now),
    );

    expect(await feedbackOn(recordId)).toEqual([
      {
        given_at: now,
        given_by: `human:${asker.userId}`,
        verdict: "helpful",
        reason: null,
        note: null,
        disputed_sentence: null,
        disputed_concept: null,
      },
    ]);
  });

  const aColleaguesRecord = async (giver: UserPrincipal): Promise<string> => {
    const colleague = await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: giver.workspaceId, role: "Viewer" }),
    );
    return recordOf(await principalFor(db(), giver.workspaceId, colleague.userId));
  };

  it.each([
    ["a colleague asked", aColleaguesRecord],
    ["nobody asked", async () => ulid()],
    ["left with no verdict", (giver: UserPrincipal) => recordOf(giver, "open")],
  ])("answers not-found for a record %s", async (_case, recordFor) => {
    const giver = await anAsker();
    const recordId = await recordFor(giver);

    const refused = await acting(giver, (principal, tx) =>
      giveFeedback(principal, tx, { recordId, verdict: "flag", reason: "wrong" }, now),
    );

    expect(await feedbackOn(recordId)).toEqual([]);
    expect(refused).toEqual({ ok: false, error: "not-found" });
  });

  const disputingAnUncitedConcept = (giver: UserPrincipal, recordId: string) =>
    acting(giver, (principal, tx) =>
      giveFeedback(
        principal,
        tx,
        {
          recordId,
          verdict: "flag",
          reason: "wrong",
          disputed: { sentence: A_DISPUTED_SENTENCE, concept: ABSENT },
        },
        now,
      ),
    );

  it("refuses a disputed concept the record does not cite", async () => {
    const asker = await anAsker();
    const recordId = await recordOf(asker);

    const refused = await disputingAnUncitedConcept(asker, recordId);

    expect(await feedbackOn(recordId)).toEqual([]);
    expect(refused).toEqual({
      ok: false,
      error: { word: "malformed", fields: { "disputed.concept": "not-in-set" } },
    });
  });

  it("answers not-found before comparing a colleague's disputed concept", async () => {
    const giver = await anAsker();
    const recordId = await aColleaguesRecord(giver);

    const refused = await disputingAnUncitedConcept(giver, recordId);

    expect(await feedbackOn(recordId)).toEqual([]);
    expect(refused).toEqual({ ok: false, error: "not-found" });
  });
});

describe("the boundary feedback is parsed at", () => {
  const flagging = (more: Readonly<Record<string, unknown>>) =>
    parse(feedbackInput, { recordId: A_RECORD, verdict: "flag", reason: "wrong", ...more });

  const malformedAt = (fields: Readonly<Record<string, string>>) => ({
    ok: false,
    error: { word: "malformed", fields },
  });

  it("holds a note and a disputed sentence to 2,000 characters", () => {
    const long = "a".repeat(2_000);

    expect(flagging({ note: long, disputed: { sentence: long, concept: CITED } })).toEqual({
      ok: true,
      value: {
        recordId: A_RECORD,
        verdict: "flag",
        reason: "wrong",
        note: long,
        disputed: { sentence: long, concept: CITED },
      },
    });
    expect([
      flagging({ note: `${long}a` }),
      flagging({ disputed: { sentence: `${long}a`, concept: CITED } }),
    ]).toEqual([malformedAt({ note: "too-big" }), malformedAt({ "disputed.sentence": "too-big" })]);
  });

  it.each([
    ["a note holding a NUL", { note: "renewed\u0000 in May" }, { note: "refused" }],
    ["a note of spaces alone", { note: "   " }, { note: "too-small" }],
    [
      "a disputed sentence holding a NUL",
      { disputed: { sentence: "kept\u0000 a year", concept: CITED } },
      { "disputed.sentence": "refused" },
    ],
    [
      "a disputed sentence with no concept",
      { disputed: { sentence: A_DISPUTED_SENTENCE } },
      { "disputed.concept": "missing" },
    ],
    [
      "a malformed disputed concept",
      { disputed: { sentence: A_DISPUTED_SENTENCE, concept: "the retention policy" } },
      { "disputed.concept": "bad-format" },
    ],
    ["a reason outside the four", { reason: "rude" }, { reason: "not-in-set" }],
    ["a malformed record id", { recordId: "the last one" }, { recordId: "bad-format" }],
  ])("refuses a flag with %s", (_case, more, fields) => {
    expect(flagging(more)).toEqual(malformedAt(fields));
  });

  it.each([
    ["a reason", { reason: "wrong" }, { reason: "wrong-type" }],
    ["a note", { note: A_NOTE }, { note: "wrong-type" }],
    [
      "a disputed sentence",
      { disputed: { sentence: A_DISPUTED_SENTENCE, concept: CITED } },
      { disputed: "wrong-type" },
    ],
  ])("refuses helpful sent with %s", (_case, more, fields) => {
    expect(parse(feedbackInput, { recordId: A_RECORD, verdict: "helpful", ...more })).toEqual(
      malformedAt(fields),
    );
  });

  it("describes every feedback input field", () => {
    expect(described(feedbackFields.shape)).toEqual({
      recordId: true,
      verdict: true,
      reason: true,
      note: true,
      disputed: true,
    });
  });
});

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
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjoxLCJyYW5rIjowLjUsImtleSI6Imh0dHBzOi8vYmV0dGVyLWFuc3dlcnMuY29tL2MvMDFKNlpaWlpaWlpaWlpaWlpaWlpaWlpaWloifSwiY291bnRzIjp7InNpemUiOjEsImZyZXF1ZW5jaWVzIjpbMV19fQ";

    expect(parse(findInput, { query: "audit", cursor })).toEqual({
      ok: true,
      value: {
        query: "audit",
        limit: 5,
        cursor: {
          run: "weak",
          bound: { weight: 1, rank: 0.5, key: ABSENT },
          counts: { size: 1, frequencies: [1] },
        },
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

  it("describes every find, open and ask input field", () => {
    expect(described(findInput.shape)).toEqual({ query: true, limit: true, cursor: true });
    expect(described(openInput.shape)).toEqual({ iri: true, locator: true });
    expect(described(askInput.shape)).toEqual({ question: true, collections: true });
  });

  it("holds a question to 2,000 characters, with no NUL", () => {
    expect(parse(askInput, { question: "a".repeat(2_000) })).toEqual({
      ok: true,
      value: { question: "a".repeat(2_000), collections: [] },
    });
    expect([
      parse(askInput, { question: "a".repeat(2_001) }),
      parse(askInput, { question: "" }),
      parse(askInput, { question: "audit\u0000logs" }),
    ]).toEqual([
      { ok: false, error: { word: "malformed", fields: { question: "too-big" } } },
      { ok: false, error: { word: "malformed", fields: { question: "too-small" } } },
      { ok: false, error: { word: "malformed", fields: { question: "refused" } } },
    ]);
  });

  it("holds the collections to twenty names of 200 characters", () => {
    const twenty = Array.from({ length: 20 }, (_unused, at) => `collection-${at}`);
    const asking = (collections: readonly string[]) =>
      parse(askInput, { question: "When is the audit?", collections });

    expect(asking(twenty)).toEqual({
      ok: true,
      value: { question: "When is the audit?", collections: twenty },
    });
    expect(asking(["a".repeat(200)]).ok).toBe(true);
    expect([
      asking([...twenty, "one-more"]),
      asking(["a".repeat(201)]),
      asking([""]),
      asking(["audits\u0000"]),
    ]).toEqual([
      { ok: false, error: { word: "malformed", fields: { collections: "too-big" } } },
      { ok: false, error: { word: "malformed", fields: { "collections.0": "too-big" } } },
      { ok: false, error: { word: "malformed", fields: { "collections.0": "too-small" } } },
      { ok: false, error: { word: "malformed", fields: { "collections.0": "refused" } } },
    ]);
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

const RETENTION_QUESTION = "How long are audit logs kept?";

const RETENTION_ANSWER: SeededConcept = {
  collection: "audits",
  kind: "Answer",
  title: "How long are audit logs kept?",
  body: "Audit logs are kept for thirteen months.\n",
};

const CONSOLE_EXPORTS: SeededConcept = {
  collection: "lms",
  kind: "Note",
  title: "Console exports",
  body: "Exports are made in the console.\n",
};

describe("what ask answers with no model", () => {
  const anAsker = async (role: Role = "Viewer") => {
    const reader = await arrange(role);
    return {
      workspaceId: reader.workspaceId,
      asker: await principalFor(db(), reader.workspaceId, reader.userId),
    };
  };

  const seededIn = (workspaceId: string, shape: SeededConcept): Promise<ConceptIri> =>
    conceptSeeded(db(), workspaceId, shape);

  const irisOf = (answer: AnswerResult): readonly ConceptIri[] =>
    answer.related.map((concept) => concept.iri);

  const pageOf = (iri: ConceptIri): string => `/knowledge/search/${iri.slice(-26)}`;

  const recordOf = async (recordId: string) => {
    const read = await db().pool.query(
      `SELECT r.asked_by, r.transport, r.collections, r.verdict, r.judge_state, r.concepts,
              r.unmapped_passages, r.completed_at IS NOT NULL AS completed, c.question
         FROM question_asked r
         JOIN question_content c ON c.record_id = r.id
        WHERE r.id = $1`,
      [recordId],
    );
    return rowsFrom(read);
  };

  const mapStateOf = async (recordId: string): Promise<unknown> => {
    const read = await db().pool.query<{ map_state: unknown }>(
      "SELECT map_state FROM question_asked WHERE id = $1",
      [recordId],
    );
    return read.rows[0]?.map_state;
  };

  it("refuses a question nothing matches, no judge having run", async () => {
    const { asker } = await anAsker();

    const answer = await asked(db(), asker, { question: "How long do we have to claim expenses?" });

    expect(withoutRecord(answer)).toEqual(REFUSED);
    expect(await recordOf(answer.recordId)).toEqual([
      {
        asked_by: actorIdOfPerson(asker.userId),
        transport: "mcp",
        collections: [],
        verdict: "refuse",
        judge_state: "not-judged",
        concepts: [],
        unmapped_passages: [],
        completed: true,
        question: "How long do we have to claim expenses?",
      },
    ]);
  });

  it("AE10: returns both matching `Answer`s as related, not judged", async () => {
    const { workspaceId, asker } = await anAsker();
    const users = {
      collection: "audits",
      kind: "Answer",
      title: "How do buyers access audit information about their users' actions?",
      body: "Buyers download their users' audit log from the console.\n",
    };
    const supplier = {
      collection: "audits",
      kind: "Answer",
      title: "How do buyers access audit information about the supplier's actions?",
      body: "The supplier sends its own audit report on request.\n",
    };
    const iris = [await seededIn(workspaceId, users), await seededIn(workspaceId, supplier)];

    const answer = await asked(db(), asker, {
      question: "How do buyers access audit information?",
      collections: ["audits"],
    });

    expect([answer.verdict, answer.judgeState, answer.answers]).toEqual([
      "related",
      "not-judged",
      [],
    ]);
    expect(
      answer.related.toSorted((one, other) => iris.indexOf(one.iri) - iris.indexOf(other.iri)),
    ).toEqual(
      [users, supplier].map(({ collection, kind, title, body }, at) => ({
        iri: iris[at],
        url: pageOf(iris[at] ?? ABSENT),
        kind,
        title,
        collection,
        body,
        trust: unverified,
        trustWords: "Unverified",
        evidence: [],
      })),
    );
  });

  it("AE5: answers related knowledge where no `Answer` matches", async () => {
    const { workspaceId, asker } = await anAsker();
    const note = await seededIn(workspaceId, CONSOLE_EXPORTS);
    const policy = await seededIn(workspaceId, {
      collection: "audits",
      title: "Audit log retention",
      body: "Audit logs are kept for thirteen months.\n",
      linksTo: [note],
    });

    const answer = await asked(db(), asker, { question: RETENTION_QUESTION });

    expect([answer.verdict, answer.judgeState, answer.answers, answer.conflicts]).toEqual([
      "related",
      "not-judged",
      [],
      [],
    ]);
    expect(answer.related).toEqual([
      {
        iri: policy,
        url: pageOf(policy),
        kind: "Policy",
        title: "Audit log retention",
        collection: "audits",
        trust: unverified,
        trustWords: "Unverified",
      },
      expect.objectContaining({ iri: note, kind: "Note" }),
    ]);
    expect(answer.related.map((concept) => "body" in concept || "evidence" in concept)).toEqual([
      false,
      false,
    ]);
    const [first] = linesOf(renderAnswer(answer));
    expect(first).toBe(RELATED_LINE);
    expect(first).not.toMatch(/answered/i);
    expect(Object.keys(answer).toSorted()).toEqual([
      "answers",
      "collections",
      "conflicts",
      "judgeState",
      "map",
      "readableCollections",
      "recordId",
      "related",
      "unmappedPassages",
      "verdict",
    ]);
  });

  it("reaches the concept holding a three-letter acronym", async () => {
    const { workspaceId, asker } = await anAsker();
    const signingIn = await seededIn(workspaceId, {
      collection: null,
      title: "Signing in",
      body: "MFA is enforced for every member of staff.\n",
    });

    const answer = await asked(db(), asker, { question: "Is MFA required?" });

    expect([answer.verdict, irisOf(answer)]).toEqual(["related", [signingIn]]);
    expect(answer.related.map((concept) => concept.collection)).toEqual([null]);
  });

  it("ranks a concept sharing three words above one sharing one", async () => {
    const { workspaceId, asker } = await anAsker();
    const one = await seededIn(workspaceId, {
      collection: "audits",
      title: "Log exports",
      body: "A log can be exported as a spreadsheet.\n",
    });
    const three = await seededIn(workspaceId, {
      collection: "audits",
      title: "Storage",
      body: "Audit logs stay in the console for a long time.\n",
    });

    const answer = await asked(db(), asker, { question: RETENTION_QUESTION });

    expect(irisOf(answer)).toEqual([three, one]);
  });

  it("keeps a named collection's concepts and every unmapped passage", async () => {
    const { workspaceId, asker } = await anAsker();
    const linked = await seededIn(workspaceId, CONSOLE_EXPORTS);
    const audits = await seededIn(workspaceId, { ...RETENTION_ANSWER, linksTo: [linked] });
    const lms = await seededIn(workspaceId, { ...RETENTION_ANSWER, collection: "lms" });
    const contract = await documentLanded(db().pool, workspaceId, {
      title: "Hosting contract",
      text: "Audit logs are kept by the host for ninety days.",
    });

    const narrowed = await asked(db(), asker, {
      question: RETENTION_QUESTION,
      collections: ["audits"],
    });
    const whole = await asked(db(), asker, { question: RETENTION_QUESTION });

    expect(irisOf(narrowed)).toEqual([audits]);
    expect(narrowed.unmappedPassages).toEqual([
      {
        locator: contract.locator,
        source: "Hosting contract",
        text: "Audit logs are kept by the host for ninety days.",
        sensitivity: "Internal",
      },
    ]);
    expect(irisOf(whole).toSorted()).toEqual([audits, lms, linked].toSorted());
    expect(whole.unmappedPassages).toEqual(narrowed.unmappedPassages);
  });

  it("returns the same concepts naming every collection or none", async () => {
    const { workspaceId, asker } = await anAsker();
    const uids = Array.from({ length: 1_002 }, () => conceptIriOf(ulid())).toSorted();
    const sections = uids.slice(0, 1_001);
    const reached = await seededIn(workspaceId, {
      ...CONSOLE_EXPORTS,
      collection: "audits",
      iri: ids.conceptIri.parse(uids.at(-1)),
    });
    const entry = await seededIn(workspaceId, { ...RETENTION_ANSWER, linksTo: [reached] });
    await seedingWith(db().pool, async (seed) => {
      for (const uid of sections) {
        await seed.mapNode({ workspaceId, uid, label: "Section", kind: null });
        await seed.mapEdge({ workspaceId, fromUid: entry, toUid: uid });
      }
    });

    const unnamed = await asked(db(), asker, { question: RETENTION_QUESTION });
    const named = await asked(db(), asker, {
      question: RETENTION_QUESTION,
      collections: ["audits"],
    });

    expect(irisOf(unnamed)).toEqual([entry, reached]);
    expect(irisOf(named)).toEqual(irisOf(unnamed));
  });

  it("names the collections it considered, a misspelt one echoed", async () => {
    const { workspaceId, asker } = await anAsker();
    await seededIn(workspaceId, RETENTION_ANSWER);
    await seededIn(workspaceId, CONSOLE_EXPORTS);

    const named = await asked(db(), asker, {
      question: RETENTION_QUESTION,
      collections: ["audits", "audts"],
    });
    const unnamed = await asked(db(), asker, { question: RETENTION_QUESTION });

    expect([named.collections, named.readableCollections]).toEqual([
      ["audits", "audts"],
      ["audits", "lms"],
    ]);
    expect([unnamed.collections, unnamed.readableCollections]).toEqual([
      ["audits", "lms"],
      ["audits", "lms"],
    ]);
  });

  it("reads an empty collections list as every collection", async () => {
    const { workspaceId, asker } = await anAsker();
    const audits = await seededIn(workspaceId, RETENTION_ANSWER);
    const lms = await seededIn(workspaceId, { ...RETENTION_ANSWER, collection: "lms" });

    const emptied = await asked(db(), asker, { question: RETENTION_QUESTION, collections: [] });
    const unnamed = await asked(db(), asker, { question: RETENTION_QUESTION });

    expect(irisOf(emptied).toSorted()).toEqual([audits, lms].toSorted());
    expect(withoutRecord(emptied)).toEqual(withoutRecord(unnamed));
  });

  it("cuts at the related cap, entry points before the walk", async () => {
    const { workspaceId, asker } = await anAsker();
    const reached = await seededIn(workspaceId, CONSOLE_EXPORTS);
    const three = await seededIn(workspaceId, {
      collection: "audits",
      title: "Storage",
      body: "Audit logs stay in the console for a long time.\n",
      linksTo: [reached],
    });
    const one = await seededIn(workspaceId, {
      collection: "audits",
      title: "Log exports",
      body: "A log can be exported as a spreadsheet.\n",
    });
    const capped = (related: number) =>
      asked(db(), asker, { question: RETENTION_QUESTION }, { caps: { ...ASK_CAPS, related } });

    expect(irisOf(await capped(1))).toEqual([three]);
    expect(irisOf(await capped(2))).toEqual([three, one]);
    expect(irisOf(await capped(3))).toEqual([three, one, reached]);
  });

  it("leaves the walk room beyond its entry points", () => {
    expect(ASK_CAPS.related).toBeGreaterThan(ASK_CAPS.entryPoints);
  });

  const askedWhileTheWalkStalls = async () => {
    const { workspaceId, asker } = await anAsker();
    const reached = await seededIn(workspaceId, CONSOLE_EXPORTS);
    const entry = await seededIn(workspaceId, { ...RETENTION_ANSWER, linksTo: [reached] });
    const now = new Date();
    const stalled = await holdingTable(db().pool, "map_node", () =>
      askedAsIs(db(), asker, { question: RETENTION_QUESTION }, { now }),
    );
    const after = await asked(db(), asker, { question: RETENTION_QUESTION });
    return { reached, entry, now, stalled, after };
  };

  it("answers from its entry points when the walk times out", async () => {
    const { reached, entry, now, stalled, after } = await askedWhileTheWalkStalls();

    expect([stalled.verdict, irisOf(stalled), stalled.map]).toEqual([
      "related",
      [entry],
      { state: "unavailable_since", since: now.toISOString() },
    ]);
    expect([irisOf(after), after.map]).toEqual([[entry, reached], { state: "live" }]);
  });

  it("records the map unavailable when the walk times out", async () => {
    const { now, stalled, after } = await askedWhileTheWalkStalls();

    expect([await mapStateOf(stalled.recordId), await mapStateOf(after.recordId)]).toEqual([
      { state: "unavailable_since", since: now.toISOString() },
      { state: "live" },
    ]);
  });

  it("keeps the question and what it returned on its record", async () => {
    const { workspaceId, asker } = await anAsker();
    const audits = await seededIn(workspaceId, {
      ...RETENTION_ANSWER,
      contentHash: "c".repeat(64),
    });
    const contract = await documentLanded(db().pool, workspaceId, {
      title: "Hosting contract",
      text: "Audit logs are kept by the host for ninety days.",
    });

    const answer = await asked(db(), asker, {
      question: RETENTION_QUESTION,
      collections: ["audits"],
    });

    expect(await recordOf(answer.recordId)).toEqual([
      {
        asked_by: actorIdOfPerson(asker.userId),
        transport: "mcp",
        collections: ["audits"],
        verdict: "related",
        judge_state: "not-judged",
        concepts: [
          {
            iri: audits,
            contentHash: "c".repeat(64),
            trust: { tier: "unverified", status: "current", verifiedAt: null, rider: null },
          },
        ],
        unmapped_passages: [contract.locator],
        completed: true,
        question: RETENTION_QUESTION,
      },
    ]);
  });

  const stepsKeepingTheirRecords = (asker: UserPrincipal) => {
    const steps = stepsFor(db().runtimePool, asker);
    const opened: string[] = [];
    const keeping: typeof steps = {
      ...steps,
      openRecord: async (opening) => {
        const record = await steps.openRecord(opening);
        if (record.ok) opened.push(record.value.recordId);
        return record;
      },
    };
    return { steps: keeping, opened };
  };

  const AN_OPEN_RECORD = { completed: false, verdict: null, judge_state: null, concepts: [] };

  const RETENTION_ASKED = { question: RETENTION_QUESTION, collections: [] };

  it("answers what a step refuses, its record left open", async () => {
    const { asker } = await anAsker();
    const { steps, opened } = stepsKeepingTheirRecords(asker);

    const answered = await ask(
      asker,
      { ...steps, read: async () => err("credentials-revoked" as const) },
      RETENTION_ASKED,
      new Date(),
    );

    expect(answered).toEqual({ ok: false, error: "credentials-revoked" });
    expect(await recordOf(opened[0] ?? "")).toEqual([
      expect.objectContaining({ ...AN_OPEN_RECORD, question: RETENTION_QUESTION }),
    ]);
  });

  it("answers a failed completion, its record left open", async () => {
    const { workspaceId, asker } = await anAsker();
    await seededIn(workspaceId, RETENTION_ANSWER);
    const { steps, opened } = stepsKeepingTheirRecords(asker);

    const answered = await ask(
      asker,
      {
        ...steps,
        completeRecord: (completion) => steps.completeRecord({ ...completion, recordId: ulid() }),
      },
      RETENTION_ASKED,
      new Date(),
    );

    expect(answered.ok).toBe(false);
    expect(String(answered.ok || answered.error)).toMatch(/no open record \w{26} to complete/);
    expect(await recordOf(opened[0] ?? "")).toEqual([
      expect.objectContaining({ ...AN_OPEN_RECORD, question: RETENTION_QUESTION }),
    ]);
  });

  it("answers a walk's failure other than a timeout", async () => {
    const { workspaceId, asker } = await anAsker();
    await seededIn(workspaceId, RETENTION_ANSWER);
    const steps = stepsFor(db().runtimePool, asker);
    let reads = 0;

    const answered = await ask(
      asker,
      {
        ...steps,
        read: (work) => {
          reads += 1;
          if (reads !== 2) return steps.read(work);
          return steps.read(async (tx) => {
            await abortTheTransaction(tx);
            return work(tx);
          });
        },
      },
      RETENTION_ASKED,
      new Date(),
    );

    expect(answered).toMatchObject({ ok: false, error: { code: "25P02" } });
  });

  it("plans the same answer and keeps no record", async () => {
    const { workspaceId, asker } = await anAsker();
    await seededIn(workspaceId, RETENTION_ANSWER);

    const planned = await acting(asker, (principal, tx) =>
      plannedOn(principal, tx, { question: RETENTION_QUESTION }),
    );
    const records = await db().pool.query("SELECT 1 FROM question_asked WHERE workspace_id = $1", [
      workspaceId,
    ]);
    const answer = await asked(db(), asker, { question: RETENTION_QUESTION });

    expect(records.rows).toEqual([]);
    expect(planned).toEqual({ ok: true, value: withoutRecord(answer) });
  });

  it("keeps an answer whole through ask's output schema", async () => {
    const { workspaceId, asker } = await anAsker();
    await seededIn(workspaceId, RETENTION_ANSWER);
    await documentLanded(db().pool, workspaceId, {
      title: "Hosting contract",
      text: "Audit logs are kept by the host for ninety days.",
    });

    const answer = await asked(db(), asker, { question: RETENTION_QUESTION });

    expect(answerOutputWith(trust).parse(answer)).toEqual(answer);
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
            collection: null,
            tags: [],
          },
          {
            layer: "sources",
            kind: "document",
            title: INVOICE_TITLE,
            locator: invoice.locator,
            sensitivity: "Internal",
            openingLine: INVOICE_TEXT,
          },
        ],
      },
    });
    expect(found.ok && renderFind(found.value)).toBe(
      [
        `Policy · ${CONCEPT_TITLE} · No collection · Unverified · ${iri}`,
        `document · ${INVOICE_TITLE} · ${NOT_COMPANY_KNOWLEDGE} · Internal · ${invoice.locator} · "${INVOICE_TEXT}"`,
      ].join("\n"),
    );
  });

  it("previews a passage by its first worded line, cut short", async () => {
    const reader = await arrange();
    const brief = `𝔸 The kingfisher brief ${"a".repeat(137)}`;
    const ledger = `The kingfisher ledger ${"runs on ".repeat(30)}to the end.`;
    const roll = `The kingfisher roll ${"x".repeat(300)}`;
    const documents = [
      [
        "The kingfisher minutes",
        "\n  \n#\n  ## The kingfisher minutes open here.\r\nThey go on below.",
        "The kingfisher minutes open here.",
      ],
      ["The kingfisher tags", "#kingfisher notes\rSecond line.", "#kingfisher notes"],
      ["The kingfisher log", "The kingfisher\tlog   runs\u2028on.", "The kingfisher log runs"],
      ["The kingfisher brief", brief, brief],
      ["The kingfisher ledger", ledger, `${Array.from(ledger).slice(0, 159).join("").trimEnd()}…`],
      [
        "The kingfisher cover",
        `${"\n  ## \n#\n".repeat(40)}The kingfisher cover opens late.`,
        "The kingfisher cover opens late.",
      ],
      [
        "The kingfisher table",
        `Name${" ".repeat(200)}Role${" ".repeat(200)}Kingfisher start date`,
        "Name Role Kingfisher start date",
      ],
      ["The kingfisher agenda", "\n# # The kingfisher agenda", "# The kingfisher agenda"],
      [
        "The kingfisher spacer",
        `${" \n#﻿\n".repeat(80)}The kingfisher spacer opens late.`,
        "The kingfisher spacer opens late.",
      ],
      ["The kingfisher grid", `Name${"　  ".repeat(150)}Role kingfisher`, "Name Role kingfisher"],
      [
        "The kingfisher annex",
        `${"\n".repeat(5)}#\u2029${"\n".repeat(330)}The kingfisher annex opens late.`,
        "The kingfisher annex opens late.",
      ],
      [
        "The kingfisher folio",
        `${"#\u2028".repeat(161)}The kingfisher folio opens late.`,
        "The kingfisher folio opens late.",
      ],
      [
        "The kingfisher roll",
        `${"#\u0085".repeat(100)}${roll}`,
        `${Array.from(roll).slice(0, 159).join("").trimEnd()}…`,
      ],
    ] as const;
    for (const [title, text] of documents)
      await documentHolding(reader.workspaceId, { title, text });

    const found = await searching(reader, documents.length);

    const openings = new Map(
      (found.ok ? found.value.matches : []).flatMap((match) =>
        match.layer === "sources" ? [[match.title, match.openingLine]] : [],
      ),
    );
    expect(Array.from(brief), "the brief's line is exactly the opening's length").toHaveLength(160);
    expect(Object.fromEntries(openings)).toEqual(
      Object.fromEntries(documents.map(([title, , opening]) => [title, opening])),
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
        openingLine: INVOICE_TEXT,
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

  it("labels each concept match with its collection, or none", async () => {
    const reader = await arrange();
    const client = await db().pool.connect();
    try {
      const seed = testData(client);
      for (const [title, path] of [
        ["Kingfisher audits", "knowledge/audits/kingfisher.md"],
        ["Kingfisher basics", "knowledge/kingfisher.md"],
      ] as const) {
        await seed.conceptIndex({
          workspaceId: reader.workspaceId,
          title,
          path,
          publishedAt: PUBLISHED_AT,
          sensitivity: "Internal",
        });
      }
    } finally {
      client.release();
    }

    const found = await searching(reader);
    const parsed = findOutputWith(trust).safeParse(found.ok && found.value);

    expect(
      parsed.data?.matches.map((match) =>
        match.layer === "bundles" ? [match.title, match.collection] : [],
      ),
    ).toEqual([
      ["Kingfisher audits", "audits"],
      ["Kingfisher basics", null],
    ]);
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
            collection: null,
            tags: [],
          },
          {
            layer: "sources",
            kind: "document",
            title: "The bid library's invoice",
            locator: invoice.locator,
            sensitivity: "Internal",
            openingLine: INVOICE_TEXT,
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
          bodyLinks: [],
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

describe("the links in an opened concept's body", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  const TO_TRAVEL_AND_THE_BOARD =
    "Book through [the travel policy](./travel.md), [as it says](./travel.md), or ask [the board](./board.md).";

  const TO_THE_BOARD = "Ask [the board](./board.md).";

  type Seed = ReturnType<typeof testData>;

  const seeded = async <T>(work: (seed: Seed) => Promise<T>): Promise<T> => {
    const client = await db().pool.connect();
    try {
      return await work(testData(client));
    } finally {
      client.release();
    }
  };

  const expensesLinking = (
    workspaceId: string,
    path: string,
    body: string,
    linked: readonly string[],
  ): Promise<ConceptIri> =>
    seeded(async (seed) => {
      const expenses = await seed.conceptIndex({ workspaceId, path, body });
      for (const toUid of linked) await seed.mapEdge({ workspaceId, fromUid: expenses.iri, toUid });
      return ids.conceptIri.parse(expenses.iri);
    });

  const indexed = (
    workspaceId: string,
    path: string,
    sensitivity: "Internal" | "Restricted",
  ): Promise<string> =>
    seeded(async (seed) => (await seed.conceptIndex({ workspaceId, path, sensitivity })).iri);

  const opened = async (reader: Awaited<ReturnType<typeof arrange>>, iri: ConceptIri) => {
    const concept = await acting(reader, (principal, tx) => open(principal, tx, { iri }, now));
    if (!concept.ok) throw new Error(`the open was refused: ${String(concept.error)}`);
    return concept.value;
  };

  it("lists each answered address once, with its concept", async () => {
    const reader = await arrange();
    const travel = await indexed(reader.workspaceId, "knowledge/travel.md", "Internal");
    const board = await indexed(reader.workspaceId, "knowledge/board.md", "Restricted");
    const expenses = await expensesLinking(
      reader.workspaceId,
      "knowledge/expenses.md",
      TO_TRAVEL_AND_THE_BOARD,
      [travel, board],
    );

    const answer = await opened(reader, expenses);

    expect(answer.found && answer.concept?.bodyLinks).toEqual([
      { ordinal: 0, address: "./travel.md", target: travel },
      { ordinal: 1, address: "./travel.md", target: travel },
    ]);
    expect(renderOpen(answer).split("\n").slice(-3)).toEqual([
      "",
      "Links in the body:",
      `- ./travel.md · ${travel}`,
    ]);
  });

  it("lists a footnote defined as a relative path", async () => {
    const reader = await arrange();
    const travel = await indexed(reader.workspaceId, "knowledge/travel.md", "Internal");
    const expenses = await expensesLinking(
      reader.workspaceId,
      "knowledge/expenses.md",
      "Mileage follows the travel policy.[^t]\n\n[^t]: ./travel.md",
      [travel],
    );

    const answer = await opened(reader, expenses);

    expect(renderOpen(answer).split("\n").slice(-2)).toEqual([
      "Links in the body:",
      `- ./travel.md · ${travel}`,
    ]);
  });

  it("lists a percent-encoded address under the file it decodes to", async () => {
    const reader = await arrange();
    const team = await indexed(reader.workspaceId, "knowledge/équipe.md", "Internal");
    const expenses = await expensesLinking(
      reader.workspaceId,
      "knowledge/expenses.md",
      "Ask [the team](./%C3%A9quipe.md).",
      [team],
    );

    const answer = await opened(reader, expenses);

    expect(renderOpen(answer).split("\n").slice(-2)).toEqual([
      "Links in the body:",
      `- ./%C3%A9quipe.md · ${team}`,
    ]);
  });

  it("keeps the links through open's output schema", async () => {
    const reader = await arrange();
    const travel = await indexed(reader.workspaceId, "knowledge/travel.md", "Internal");
    const expenses = await expensesLinking(
      reader.workspaceId,
      "knowledge/expenses.md",
      TO_TRAVEL_AND_THE_BOARD,
      [travel],
    );

    const parsed = openOutputWith(z.unknown()).parse(await opened(reader, expenses));

    expect(parsed).toMatchObject({
      concept: {
        bodyLinks: [
          { ordinal: 0, address: "./travel.md", target: travel },
          { ordinal: 1, address: "./travel.md", target: travel },
        ],
      },
    });
  });

  it("writes one text for a concept withheld and one unwritten", async () => {
    const reader = await arrange();
    const admin = await seeded(async (seed) => {
      const member = await seed.member({ workspaceId: reader.workspaceId, role: "Admin" });
      return { workspaceId: reader.workspaceId, userId: member.userId };
    });
    const board = await indexed(reader.workspaceId, "knowledge/held/board.md", "Restricted");
    const toWithheld = await expensesLinking(
      reader.workspaceId,
      "knowledge/held/expenses.md",
      TO_THE_BOARD,
      [board],
    );
    const toNothing = await expensesLinking(
      reader.workspaceId,
      "knowledge/bare/expenses.md",
      TO_THE_BOARD,
      [],
    );

    const nothingToFollow = ["# Expenses", "", TO_THE_BOARD, "", "_Unverified_"].join("\n");
    expect(renderOpen(await opened(reader, toWithheld))).toBe(nothingToFollow);
    expect(renderOpen(await opened(reader, toNothing))).toBe(nothingToFollow);
    expect(
      renderOpen(await opened(admin, toWithheld))
        .split("\n")
        .slice(-2),
    ).toEqual(["Links in the body:", `- ./board.md · ${board}`]);
  });

  it("writes no heading where no link is answered", () => {
    expect(
      renderOpen({
        found: true,
        concept: {
          iri: "https://better-answers.com/c/01A",
          frontmatter: { title: "Expenses", type: "Policy" },
          body: TO_THE_BOARD,
          relations: [],
          bodyLinks: [],
          trust: unverified,
          trustWords: "Unverified",
          evidence: [],
        },
      }),
    ).toBe(["# Expenses", "", TO_THE_BOARD, "", "_Unverified_"].join("\n"));
  });
});
