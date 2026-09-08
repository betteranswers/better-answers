import { testData } from "@better-answers/schema/testing";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ask,
  find,
  giveFeedback,
  mapWords,
  NOT_ANSWERED,
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
import type { Tx } from "../src/store/postgres/index.ts";
import { postgresForSuite, readingAs } from "./suite-postgres.ts";

/**
 * The slice's four acts and the human renderings derived from them (`[TEST1]`): the reader's
 * words and no others (CONTEXT.md, *trust words the reader sees*, *map*, *feedback*), the
 * answer's verdict-first shape with its map line (ADR 0016), and `open`'s two forms (ADR
 * 0018). Every expected string is written down rather than derived from the module, so an
 * assertion can disagree with the code it is about.
 */

const db = postgresForSuite();

/**
 * A workspace with one reader in it. The acts take a Principal and the transaction it was
 * resolved in, so even the ones whose bodies read nothing yet are called the way a transport
 * calls them, over a real database, rather than over a value a test composed.
 */
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

/** Run an act as that reader, inside one transaction, the way a transport would. */
const acting = <T>(
  reader: { readonly workspaceId: string; readonly userId: string },
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => readingAs(db().runtimePool, reader, work);

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
  it("names the tier for a current unit, with the person, the date and a rider where there is one", () => {
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

  it("says a person checked it without naming one, and without a date, where the check has neither", () => {
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

  it("shows a date it cannot read back as the file wrote it, never as an invalid date", () => {
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

  it("names the status when it is not current, whatever the tier", () => {
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
  it("puts the verdict first and the map's line second, for each of the map's three states", () => {
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

  it("puts an answer's own text after the map line, then its citations, numbered from one", () => {
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

  it("warns for the caller's role in the verdict line, and answers as it otherwise would", () => {
    expect(renderAnswer(answer({ verdict: "warn", citations: [] }))).toBe(
      [
        "**Answered with a warning for your role.**",
        "_map as of now_",
        "",
        "The company holds ISO/IEC 27001:2022.",
      ].join("\n"),
    );
  });

  it("renders a refusal as the one sentence, with no prose, no citations and its unmapped passages", () => {
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
  it("says nothing matches where there are no hits, and one line per hit where there are", () => {
    expect(renderFind({ query: "expenses", hits: [] })).toBe(
      "Nothing in the company's knowledge matches that.",
    );
    expect(
      renderFind({
        query: "expenses",
        hits: [
          {
            iri: "https://better-answers.com/c/01A",
            kind: "Policy",
            title: "Expenses",
            trust: unchecked,
            bundle: "acme",
            tags: [],
          },
          {
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
  it("renders a passage as a quotation with its source, locator and sensitivity word", () => {
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

  it("renders a concept as its title, its body, its trust caption and the evidence it cites", () => {
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

  it("heads a concept with its IRI where the file names no title, and leaves the evidence block out where it cites none", () => {
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

  it("names what was asked for where there is nothing to show", () => {
    expect(renderOpen({ found: false, iri: "https://better-answers.com/c/01C" })).toBe(
      "No concept at https://better-answers.com/c/01C.",
    );
    // A wire result that named neither, which the type allows so the schema and this type
    // agree: the reader is told which of the two forms answered nothing, not shown a blank.
    expect(renderOpen({ found: false })).toBe("No passage at that locator.");
    expect(renderOpen({ found: true })).toBe("Nothing to show.");
  });

  it("renders feedback in words, never the wire token, and names every reason a reader may flag for", () => {
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
  it("hands every caller an outcome to read, never one to catch", () => {
    expectTypeOf(find).returns.resolves.toEqualTypeOf<Result<FindResult, never>>();
    // `open` reads a store now (T-052), so its union has widened to carry the store's own
    // Error — the shape the convention's rule 3 promised would not change when a body
    // arrived, and did not.
    expectTypeOf(open).returns.resolves.toEqualTypeOf<Result<OpenResult, Error>>();
    expectTypeOf(ask).returns.resolves.toEqualTypeOf<Result<AnswerResult, never>>();
    expectTypeOf(giveFeedback).returns.resolves.toEqualTypeOf<Result<FeedbackReceipt, never>>();
  });

  it("answers a search with the query it was asked and no hits, until the index is read", async () => {
    const reader = await arrange();

    const found = await acting(reader, (principal, tx) =>
      find(principal, tx, { query: "expenses", limit: 10 }),
    );

    expect(found).toEqual({ ok: true, value: { query: "expenses", hits: [] } });
  });

  it("refuses every question with the one sentence, over a map that is live", async () => {
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

  it("hands a reader back a receipt for the feedback they gave, in their own words", async () => {
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

  it("answers a passage by locator as not found, until the source catalogue exists", async () => {
    const reader = await arrange();

    const opened = await acting(reader, (principal, tx) => open(principal, tx, { locator: "p.4" }));

    expect(opened).toEqual({ ok: true, value: { found: false, locator: "p.4" } });
  });

  it("hands a read that failed back as an error, never as a concept nobody minted", async () => {
    const reader = await arrange();
    let answered: Result<OpenResult, Error> | undefined;

    // A failed statement leaves the transaction aborted, so the read that follows really
    // does fail — the store failure `open` has to tell apart from an absent concept, which
    // it answers with `found: false`. `[TEST8]`: the opener's rejection is asserted first,
    // because a transaction that answered COMMIT with ROLLBACK landed nothing either way.
    await expect(
      acting(reader, async (principal, tx) => {
        await tx.query("SELECT 1 / 0").catch(() => undefined);
        answered = await open(principal, tx, { iri: "https://better-answers.com/c/01A" });
      }),
    ).rejects.toThrow("the transaction did not commit");

    expect(answered?.ok).toBe(false);
  });
});
