import { describe, expect, it } from "vitest";

import { conceptIriOf, ids, ulid, type ConceptIri } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import { find, findCursor, type FindPosition, type FindResult } from "../../src/answering/index.ts";
import type { Result, UserPrincipal } from "../../src/kernel/index.ts";
import type { Tx } from "../../src/store/postgres/index.ts";
import {
  connectedSourceHolding,
  passageUnder,
  seededBy,
  visibilitySuite,
} from "../fixtures/sourced-concept.ts";
import { documentLanded } from "../support/suite-documents.ts";
import { answered } from "../support/suite-postgres.ts";
import { plannedOn } from "./asking.ts";

const { db, arrange, reading } = visibilitySuite();

const NOW = new Date("2026-10-09T12:00:00.000Z");

const UNRELATED = "Nothing here bears on it.";

type ConceptShape = {
  readonly title: string;
  readonly body?: string;
  readonly sensitivity?: string;
};

const conceptLanded = (
  workspaceId: string,
  { title, body, sensitivity }: ConceptShape,
): Promise<ConceptIri> =>
  seededBy(db(), async (seed) => {
    const row = await seed.conceptIndex({
      workspaceId,
      title,
      body: body ?? UNRELATED,
      frontmatter: { title, type: "Policy" },
      ...(sensitivity === undefined ? {} : { sensitivity }),
    });
    return ids.conceptIri.parse(row.iri);
  });

const conceptsLanded = async (
  workspaceId: string,
  shapes: readonly ConceptShape[],
): Promise<void> => {
  for (const shape of shapes) await conceptLanded(workspaceId, shape);
};

const searching = async (
  person: UserPrincipal,
  query: string,
  limit = 10,
  after?: FindPosition,
): Promise<FindResult> =>
  answered(
    await reading(person, (reader, tx) => find(reader, tx, { query, limit, cursor: after }, NOW)),
  );

const titlesOf = (result: FindResult): readonly string[] =>
  result.matches.map((match) => match.title);

const AUDIT_LOGS_RETENTION = "Audit Logs Retention";

const QUESTION = "how long do we keep audit logs";

describe("find, by any of the query's words", () => {
  it("matches a question's words, above a one-word match", async () => {
    const { workspaceId, viewer } = await arrange();
    await conceptsLanded(workspaceId, [
      { title: "Audit committee" },
      { title: AUDIT_LOGS_RETENTION },
    ]);

    expect(titlesOf(await searching(viewer, QUESTION))).toEqual([
      AUDIT_LOGS_RETENTION,
      "Audit committee",
    ]);
  });

  it("reaches a plural title from its singular words", async () => {
    const { workspaceId, viewer } = await arrange();
    await conceptsLanded(workspaceId, [{ title: AUDIT_LOGS_RETENTION }]);

    expect(titlesOf(await searching(viewer, "audit log retention"))).toEqual([
      AUDIT_LOGS_RETENTION,
    ]);
  });

  it("ranks one word repeated below every word held once", async () => {
    const { workspaceId, viewer } = await arrange();
    await conceptsLanded(workspaceId, [
      { title: "Security notes", body: Array.from({ length: 12 }, () => "audit").join(" ") },
      { title: AUDIT_LOGS_RETENTION },
    ]);

    expect(titlesOf(await searching(viewer, "audit log retention"))).toEqual([
      AUDIT_LOGS_RETENTION,
      "Security notes",
    ]);
  });

  it("ranks title words above the same words in a body", async () => {
    const { workspaceId, viewer } = await arrange();
    await conceptsLanded(workspaceId, [
      { title: "Records", body: "Audit logs are kept." },
      { title: "Audit Logs" },
    ]);

    expect(titlesOf(await searching(viewer, "audit logs"))).toEqual(["Audit Logs", "Records"]);
  });

  it("returns strong concepts, then passages, then weak concepts", async () => {
    const { workspaceId, viewer } = await arrange();
    await threeRunsLanded(workspaceId);

    expect(titlesOf(await searching(viewer, QUESTION))).toEqual([
      "Keep audit records long",
      AUDIT_LOGS_RETENTION,
      "The audit log handbook",
      "Log rotation",
      "Committee",
    ]);
  });

  it("puts every concept before every passage for one word", async () => {
    const { workspaceId, viewer } = await arrange();
    await documentLanded(db().pool, workspaceId, {
      title: "The audit handbook",
      text: "Audit, audit and audit again.",
    });
    await conceptsLanded(workspaceId, [
      { title: "Committee", body: "The audit committee meets." },
      { title: "Audit" },
    ]);

    expect(titlesOf(await searching(viewer, "audit"))).toEqual([
      "Audit",
      "Committee",
      "The audit handbook",
    ]);
  });

  it("matches nothing on stop words alone, in either arm", async () => {
    const { workspaceId, viewer } = await arrange();
    await documentLanded(db().pool, workspaceId, { title: "Notes", text: "It is what it is." });
    await conceptsLanded(workspaceId, [{ title: "The policy", body: "It is what it is." }]);

    expect(await searching(viewer, "it is the")).toEqual({ query: "it is the", matches: [] });
  });

  it("matches by its words through `!`, `:*`, `&` and parentheses", async () => {
    const { workspaceId, viewer } = await arrange();
    await documentLanded(db().pool, workspaceId, { title: "The trail", text: "An audit trail." });
    await conceptsLanded(workspaceId, [{ title: "Audit Logs" }]);

    expect(titlesOf(await searching(viewer, "!audit:* & (logs"))).toEqual([
      "Audit Logs",
      "The trail",
    ]);
  });
});

const threeRunsLanded = async (workspaceId: string): Promise<void> => {
  await documentLanded(db().pool, workspaceId, {
    title: "The audit log handbook",
    text: "We keep audit logs.",
  });
  await conceptsLanded(workspaceId, [
    { title: "Committee", body: "The audit committee meets." },
    { title: AUDIT_LOGS_RETENTION },
    { title: "Log rotation" },
    { title: "Keep audit records long" },
  ]);
};

const PAST_THE_END =
  "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjowLCJyYW5rIjowLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZNTU1NTU1NTU1NTU1NTU1NTU1NTU1NIn0sImNvdW50cyI6eyJzaXplIjowLCJmcmVxdWVuY2llcyI6W119fQ";

const pagesOf = async (
  person: UserPrincipal,
  limit: number,
  labelled: (result: FindResult) => readonly string[] = titlesOf,
): Promise<readonly (readonly string[])[]> => {
  const pages: (readonly string[])[] = [];
  let after: FindPosition | undefined;
  do {
    const page = await searching(person, QUESTION, limit, after);
    pages.push(labelled(page));
    after = page.nextCursor === undefined ? undefined : findCursor.parse(page.nextCursor);
  } while (after !== undefined);
  return pages;
};

const titlesOrLocatorsOf = (result: FindResult): readonly string[] =>
  result.matches.map((match) => (match.layer === "bundles" ? match.title : match.locator));

const ALIKE = "Audit logs, kept long.";

describe("find's pages", () => {
  it("continues each run after the cursor, ending with no cursor", async () => {
    const { workspaceId, viewer } = await arrange();
    await threeRunsLanded(workspaceId);

    expect(await pagesOf(viewer, 2)).toEqual([
      ["Keep audit records long", AUDIT_LOGS_RETENTION],
      ["The audit log handbook", "Log rotation"],
      ["Committee"],
    ]);
  });

  it("names where the page ended in its cursor", async () => {
    const { workspaceId, viewer } = await arrange();
    await conceptLanded(workspaceId, { title: "Log rotation" });
    const retention = await conceptLanded(workspaceId, { title: AUDIT_LOGS_RETENTION });

    const page = await searching(viewer, QUESTION, 1);

    expect(findCursor.parse(page.nextCursor)).toEqual({
      run: "strong",
      bound: { weight: matching.closeTo(Math.log(2.4), 12), rank: 2, key: retention },
      counts: { size: 2, frequencies: [1, 0, 2, 0] },
    });
  });

  it("answers past the end with no matches and no cursor", async () => {
    const { workspaceId, viewer } = await arrange();
    await threeRunsLanded(workspaceId);

    expect(await searching(viewer, QUESTION, 2, findCursor.parse(PAST_THE_END))).toEqual({
      query: QUESTION,
      matches: [],
    });
  });

  it("continues the passage run after a cursor inside it", async () => {
    const { workspaceId, viewer } = await arrange();
    const twice = await connectedSourceHolding(db(), workspaceId);
    for (const [ordinal, charStart] of [
      [0, 0],
      [1, ALIKE.length],
    ] as const) {
      await passageUnder(db(), workspaceId, twice, {
        content: ALIKE,
        ordinal,
        charStart,
        charEnd: charStart + ALIKE.length,
      });
    }
    const once = await connectedSourceHolding(db(), workspaceId);
    await passageUnder(db(), workspaceId, once, {
      content: "Audit logs.",
      ordinal: 0,
      charStart: 0,
      charEnd: 11,
    });
    await conceptLanded(workspaceId, { title: AUDIT_LOGS_RETENTION });

    expect(await pagesOf(viewer, 2, titlesOrLocatorsOf)).toEqual([
      [AUDIT_LOGS_RETENTION, `${twice.documentId}/chars:0-22`],
      [`${twice.documentId}/chars:22-44`, `${once.documentId}/chars:0-11`],
    ]);
  });

  it.each([
    ["the largest bounds", Number.MAX_VALUE, Number.MAX_VALUE],
    ["the smallest bounds", Number.MIN_VALUE, Number.MIN_VALUE],
  ])("reads a cursor of %s without error", async (_case, weight, rank) => {
    const { workspaceId, viewer } = await arrange();
    await conceptsLanded(workspaceId, [{ title: AUDIT_LOGS_RETENTION }]);

    const page = await searching(viewer, QUESTION, 10, {
      run: "strong",
      bound: { weight, rank, key: conceptIriOf(ulid()) },
      counts: { size: 1, frequencies: [0, 0, 1, 0] },
    });

    expect(page.query).toBe(QUESTION);
  });

  it("pages past a withheld concept as past an absent one", async () => {
    const { workspaceId, viewer } = await arrange();
    const withheld = await conceptLanded(workspaceId, {
      title: AUDIT_LOGS_RETENTION,
      body: "Keep them long.",
      sensitivity: "Restricted",
    });
    await conceptsLanded(workspaceId, [{ title: "Audit Logs" }, { title: "Audit" }]);
    const after = (key: ConceptIri): FindPosition => ({
      run: "strong",
      bound: { weight: Number.MAX_VALUE, rank: 2.4, key },
      counts: { size: 3, frequencies: [3, 0, 2, 0] },
    });

    const [past, absent] = await Promise.all([
      searching(viewer, QUESTION, 10, after(withheld)),
      searching(viewer, QUESTION, 10, after(conceptIriOf(ulid()))),
    ]);

    expect(titlesOf(past)).toEqual(["Audit Logs", "Audit"]);
    expect(past).toEqual(absent);
  });

  it("pages a tie as counted, across a write between pages", async () => {
    const { workspaceId, viewer } = await arrange();
    await conceptsLanded(workspaceId, [
      { title: "Audit Plan" },
      { title: "Audit Policy" },
      { title: "Audit Logs" },
    ]);
    const unpaged = titlesOf(await searching(viewer, "audit"));
    const first = await searching(viewer, "audit", 1);

    await conceptLanded(workspaceId, { title: "Holiday policy" });
    const rest = await searching(viewer, "audit", 10, findCursor.parse(first.nextCursor));

    expect([...titlesOf(first), ...titlesOf(rest)]).toEqual(unpaged);
    expect(unpaged).toHaveLength(3);
  });

  it("pages a 500-character query of common words to page two", async () => {
    const { workspaceId, viewer } = await arrange();
    const query = Array.from({ length: 120 }, (_, at) => `w${String(at)}`).join(" ");
    for (let at = 0; at < 25; at += 1) {
      await conceptLanded(workspaceId, { title: `Concept ${String(at)}`, body: query });
    }

    const first = await searching(viewer, query, 10);
    const second = await searching(viewer, query, 10, findCursor.parse(first.nextCursor));

    expect(query.length).toBeLessThanOrEqual(500);
    expect(first.nextCursor?.length).toBeGreaterThan(512);
    expect(titlesOf(second)).toHaveLength(10);
    expect(titlesOf(second).filter((title) => titlesOf(first).includes(title))).toEqual([]);
  });

  it("weighs a Viewer's concepts as before a Restricted one lands", async () => {
    const { workspaceId, viewer } = await arrange();
    await conceptsLanded(workspaceId, [
      { title: "Audit Logs" },
      { title: "Audit Plan" },
      { title: "Retention" },
    ]);
    const read = async () => {
      const page = await searching(viewer, "audit retention", 1);
      return {
        titles: titlesOf(await searching(viewer, "audit retention")),
        next: page.nextCursor,
      };
    };
    const before = await read();

    await conceptLanded(workspaceId, { title: "Retention", sensitivity: "Restricted" });

    expect(await read()).toEqual(before);
    expect(before.titles[0]).toBe("Retention");
  });

  it("weighs a Viewer's passages as before a Restricted one lands", async () => {
    const { workspaceId, viewer } = await arrange();
    const internal = await connectedSourceHolding(db(), workspaceId);
    for (const [ordinal, content] of ["Audit logs.", "Retention schedule."].entries()) {
      await passageUnder(db(), workspaceId, internal, {
        content,
        ordinal,
        charStart: ordinal * 100,
        charEnd: ordinal * 100 + content.length,
      });
    }
    const read = async () => {
      const page = await searching(viewer, "audit retention", 1);
      const all = await searching(viewer, "audit retention");
      return { found: titlesOrLocatorsOf(all), next: page.nextCursor };
    };
    const before = await read();

    const restricted = await connectedSourceHolding(db(), workspaceId, {
      sensitivity: "Restricted",
    });
    await passageUnder(db(), workspaceId, restricted, {
      content: "Retention.",
      ordinal: 0,
      charStart: 0,
      charEnd: 10,
    });

    expect(await read()).toEqual(before);
    expect(before.found).toEqual([
      `${internal.documentId}/chars:0-11`,
      `${internal.documentId}/chars:100-119`,
    ]);
  });

  it("matches a Restricted concept for an Admin alone, uncounted", async () => {
    const { workspaceId, viewer, admin } = await arrange();
    await conceptsLanded(workspaceId, [
      { title: AUDIT_LOGS_RETENTION, sensitivity: "Restricted" },
      { title: "Audit Logs" },
    ]);

    const [toTheViewer, toTheAdmin] = await Promise.all([
      searching(viewer, QUESTION, 1),
      searching(admin, QUESTION, 1),
    ]);

    expect(toTheViewer).toEqual({
      query: QUESTION,
      matches: [matching.objectContaining({ title: "Audit Logs" })],
    });
    expect(titlesOf(toTheAdmin)).toEqual([AUDIT_LOGS_RETENTION]);
    expect(toTheAdmin.nextCursor).toBeDefined();
  });
});

const afterAFailedStatement = async <T, Refused>(
  person: UserPrincipal,
  work: (reader: UserPrincipal, tx: Tx) => Promise<Result<T, Refused>>,
): Promise<Result<T, Refused> | undefined> => {
  let outcome: Result<T, Refused> | undefined;
  await expect(
    reading(person, async (reader, tx) => {
      await tx.query("SELECT 1 / 0").catch(() => undefined);
      outcome = await work(reader, tx);
    }),
  ).rejects.toThrow("the transaction did not commit");
  return outcome;
};

const PASSAGES_CURSOR =
  "eyJydW4iOiJwYXNzYWdlcyIsImJvdW5kIjp7IndlaWdodCI6MSwicmFuayI6MC4xLCJrZXkiOnsic291cmNlRG9jdW1lbnRJZCI6IjAxSjZEREREREREREREREREREREREREREREIiwiY2hhclN0YXJ0IjowfX0sImNvdW50cyI6eyJzaXplIjoyLCJmcmVxdWVuY2llcyI6WzEsMl19fQ";

describe("a failed read", () => {
  it.each([
    ["find from the first run", undefined],
    ["find from the passage run", findCursor.parse(PASSAGES_CURSOR)],
  ])("answers %s as an error", async (_case, after) => {
    const { viewer } = await arrange();

    const outcome = await afterAFailedStatement(viewer, (reader, tx) =>
      find(reader, tx, { query: QUESTION, limit: 10, cursor: after }, NOW),
    );

    expect(outcome?.ok).toBe(false);
  });

  it("answers ask's first read as an error", async () => {
    const { viewer } = await arrange();

    const outcome = await afterAFailedStatement(viewer, (reader, tx) =>
      plannedOn(reader, tx, { question: QUESTION }),
    );

    expect(outcome?.ok).toBe(false);
  });
});

describe("ask's entry step", () => {
  const relatedTo = async (viewer: UserPrincipal, question: string) =>
    answered(await reading(viewer, (reader, tx) => plannedOn(reader, tx, { question }))).related;

  it("returns a concept whose body alone holds a word", async () => {
    const { workspaceId, viewer } = await arrange();
    const records = await conceptLanded(workspaceId, {
      title: "Records",
      body: "Our audits run every spring.",
    });
    await conceptLanded(workspaceId, { title: "Holiday policy" });

    const related = await relatedTo(viewer, "When is the audit?");

    expect(related.map((concept) => concept.iri)).toEqual([records]);
  });

  it("links a concept to its page by its ulid", async () => {
    const { workspaceId, viewer } = await arrange();
    const iri = "https://better-answers.com/c/01J8ZQ4M7V3K9T2R5N6P8W1XYD";
    await seededBy(db(), async (seed) => {
      await seed.conceptIdentity({ workspaceId, iri });
      await seed.conceptIndex({ workspaceId, iri, title: "Audit Logs Retention" });
    });

    const related = await relatedTo(viewer, "audit retention");

    expect(related.map((concept) => [concept.iri, concept.url])).toEqual([
      [iri, "/knowledge/search/01J8ZQ4M7V3K9T2R5N6P8W1XYD"],
    ]);
  });
});

describe("the cursor find hands out", () => {
  it.each([
    ["an empty string", ""],
    ["text outside base64url", "not a cursor!"],
    ["base64url of no JSON", "ew"],
    [
      "a run find has no name for",
      "eyJydW4iOiJtaWRkbGUiLCJib3VuZCI6eyJ3ZWlnaHQiOjAsInJhbmsiOjAsImtleSI6Imh0dHBzOi8vYmV0dGVyLWFuc3dlcnMuY29tL2MvMDFKNk1NTU1NTU1NTU1NTU1NTU1NTU1NTU0ifSwiY291bnRzIjp7InNpemUiOjAsImZyZXF1ZW5jaWVzIjpbXX19",
    ],
    [
      "a negative weight",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjotMSwicmFuayI6MCwia2V5IjoiaHR0cHM6Ly9iZXR0ZXItYW5zd2Vycy5jb20vYy8wMUo2TU1NTU1NTU1NTU1NTU1NTU1NTU1NTSJ9LCJjb3VudHMiOnsic2l6ZSI6MCwiZnJlcXVlbmNpZXMiOltdfX0",
    ],
    [
      "a weight that is no number",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjoiMSIsInJhbmsiOjAsImtleSI6Imh0dHBzOi8vYmV0dGVyLWFuc3dlcnMuY29tL2MvMDFKNk1NTU1NTU1NTU1NTU1NTU1NTU1NTU0ifSwiY291bnRzIjp7InNpemUiOjAsImZyZXF1ZW5jaWVzIjpbXX19",
    ],
    [
      "a cursor from before find weighed words",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsibWF0Y2hlZCI6MCwicmFuayI6MCwia2V5IjoiaHR0cHM6Ly9iZXR0ZXItYW5zd2Vycy5jb20vYy8wMUo2TU1NTU1NTU1NTU1NTU1NTU1NTU1NTSJ9fQ",
    ],
    [
      "a negative rank",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjowLCJyYW5rIjotMC4xLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZNTU1NTU1NTU1NTU1NTU1NTU1NTU1NIn0sImNvdW50cyI6eyJzaXplIjowLCJmcmVxdWVuY2llcyI6W119fQ",
    ],
    [
      "a key that is no IRI",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjowLCJyYW5rIjowLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jL25vcGUifSwiY291bnRzIjp7InNpemUiOjAsImZyZXF1ZW5jaWVzIjpbXX19",
    ],
    [
      "a key of another run",
      "eyJydW4iOiJwYXNzYWdlcyIsImJvdW5kIjp7IndlaWdodCI6MCwicmFuayI6MCwia2V5IjoiaHR0cHM6Ly9iZXR0ZXItYW5zd2Vycy5jb20vYy8wMUo2TU1NTU1NTU1NTU1NTU1NTU1NTU1NTSJ9LCJjb3VudHMiOnsic2l6ZSI6MCwiZnJlcXVlbmNpZXMiOltdfX0",
    ],
    [
      "a key it does not know",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjowLCJyYW5rIjowLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZNTU1NTU1NTU1NTU1NTU1NTU1NTU1NIn0sImNvdW50cyI6eyJzaXplIjowLCJmcmVxdWVuY2llcyI6W119LCJleHRyYSI6MX0",
    ],
    [
      "a cursor that counted no corpus",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjowLCJyYW5rIjowLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZNTU1NTU1NTU1NTU1NTU1NTU1NTU1NIn19",
    ],
    [
      "a word held by more rows than were counted",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjowLCJyYW5rIjowLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZNTU1NTU1NTU1NTU1NTU1NTU1NTU1NIn0sImNvdW50cyI6eyJzaXplIjoxLCJmcmVxdWVuY2llcyI6WzJdfX0",
    ],
    [
      "a fractional corpus size",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsid2VpZ2h0IjowLCJyYW5rIjowLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZNTU1NTU1NTU1NTU1NTU1NTU1NTU1NIn0sImNvdW50cyI6eyJzaXplIjoxLjUsImZyZXF1ZW5jaWVzIjpbXX19",
    ],
    ["a character outside base64url before it", `!${PAST_THE_END}`],
    ["a character outside base64url after it", `${PAST_THE_END}!`],
    ["one character too long", `${PAST_THE_END}${"A".repeat(1025 - PAST_THE_END.length)}`],
  ])("refuses %s", (_case, cursor) => {
    expect(findCursor.safeParse(cursor).success).toBe(false);
  });

  it("reads a passage's position by document and offset", () => {
    expect(findCursor.parse(PASSAGES_CURSOR)).toEqual({
      run: "passages",
      bound: {
        weight: 1,
        rank: 0.1,
        key: { sourceDocumentId: "01J6DDDDDDDDDDDDDDDDDDDDDD", charStart: 0 },
      },
      counts: { size: 2, frequencies: [1, 2] },
    });
  });
});
