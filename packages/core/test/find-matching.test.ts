import { describe, expect, it } from "vitest";

import { conceptIriOf, ids, ulid, type ConceptIri } from "@better-answers/schema";

import {
  ask,
  find,
  findCursor,
  type FindPosition,
  type FindResult,
} from "../src/answering/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import {
  connectedSourceHolding,
  passageUnder,
  seededBy,
  visibilitySuite,
} from "./sourced-concept.ts";
import { documentLanded } from "./suite-documents.ts";
import { answered } from "./suite-postgres.ts";

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
  answered(await reading(person, (reader, tx) => find(reader, tx, { query, limit, after }, NOW)));

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

/** Two strong concepts, a passage, and two weak concepts, each run in a known order. */
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
  "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsibWF0Y2hlZCI6MCwicmFuayI6MCwia2V5IjoiaHR0cHM6Ly9iZXR0ZXItYW5zd2Vycy5jb20vYy8wMUo2TU1NTU1NTU1NTU1NTU1NTU1NTU1NTSJ9fQ";

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

/** Two passages alike but for their span, so only the key orders them. */
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
      bound: { matched: 2, rank: 2, key: retention },
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
      bound: { matched: 4, rank: 2.4, key },
    });

    const [past, absent] = await Promise.all([
      searching(viewer, QUESTION, 10, after(withheld)),
      searching(viewer, QUESTION, 10, after(conceptIriOf(ulid()))),
    ]);

    expect(titlesOf(past)).toEqual(["Audit Logs", "Audit"]);
    expect(past).toEqual(absent);
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
      matches: [expect.objectContaining({ title: "Audit Logs" })],
    });
    expect(titlesOf(toTheAdmin)).toEqual([AUDIT_LOGS_RETENTION]);
    expect(toTheAdmin.nextCursor).toBeDefined();
  });
});

describe("ask's per-word lookup", () => {
  it("cites a concept whose body alone holds a word", async () => {
    const { workspaceId, viewer } = await arrange();
    const records = await conceptLanded(workspaceId, {
      title: "Records",
      body: "Our audits run every spring.",
    });
    await conceptLanded(workspaceId, { title: "Holiday policy" });

    const answer = answered(
      await reading(viewer, (reader, tx) => ask(reader, tx, { question: "When is the audit?" })),
    );

    expect(answer.citations).toEqual([{ iri: records, url: records }]);
  });
});

describe("the cursor find hands out", () => {
  it.each([
    ["an empty string", ""],
    ["text outside base64url", "not a cursor!"],
    ["base64url of no JSON", "ew"],
    [
      "a run find has no name for",
      "eyJydW4iOiJtaWRkbGUiLCJib3VuZCI6eyJtYXRjaGVkIjowLCJyYW5rIjowLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZNTU1NTU1NTU1NTU1NTU1NTU1NTU1NIn19",
    ],
    [
      "a negative word count",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsibWF0Y2hlZCI6LTEsInJhbmsiOjAsImtleSI6Imh0dHBzOi8vYmV0dGVyLWFuc3dlcnMuY29tL2MvMDFKNk1NTU1NTU1NTU1NTU1NTU1NTU1NTU0ifX0",
    ],
    [
      "a fractional word count",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsibWF0Y2hlZCI6MS41LCJyYW5rIjowLCJrZXkiOiJodHRwczovL2JldHRlci1hbnN3ZXJzLmNvbS9jLzAxSjZNTU1NTU1NTU1NTU1NTU1NTU1NTU1NIn19",
    ],
    [
      "a negative rank",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsibWF0Y2hlZCI6MCwicmFuayI6LTAuMSwia2V5IjoiaHR0cHM6Ly9iZXR0ZXItYW5zd2Vycy5jb20vYy8wMUo2TU1NTU1NTU1NTU1NTU1NTU1NTU1NTSJ9fQ",
    ],
    [
      "a key that is no IRI",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsibWF0Y2hlZCI6MCwicmFuayI6MCwia2V5IjoiaHR0cHM6Ly9iZXR0ZXItYW5zd2Vycy5jb20vYy9ub3BlIn19",
    ],
    [
      "a key of another run",
      "eyJydW4iOiJwYXNzYWdlcyIsImJvdW5kIjp7Im1hdGNoZWQiOjAsInJhbmsiOjAsImtleSI6Imh0dHBzOi8vYmV0dGVyLWFuc3dlcnMuY29tL2MvMDFKNk1NTU1NTU1NTU1NTU1NTU1NTU1NTU0ifX0",
    ],
    [
      "a key it does not know",
      "eyJydW4iOiJ3ZWFrIiwiYm91bmQiOnsibWF0Y2hlZCI6MCwicmFuayI6MCwia2V5IjoiaHR0cHM6Ly9iZXR0ZXItYW5zd2Vycy5jb20vYy8wMUo2TU1NTU1NTU1NTU1NTU1NTU1NTU1NTSJ9LCJleHRyYSI6MX0",
    ],
    ["one character too long", `${PAST_THE_END}${"A".repeat(513 - PAST_THE_END.length)}`],
  ])("refuses %s", (_case, cursor) => {
    expect(findCursor.safeParse(cursor).success).toBe(false);
  });

  it("reads a passage's position by document and offset", () => {
    expect(
      findCursor.parse(
        "eyJydW4iOiJwYXNzYWdlcyIsImJvdW5kIjp7Im1hdGNoZWQiOjEsInJhbmsiOjAuMSwia2V5Ijp7InNvdXJjZURvY3VtZW50SWQiOiIwMUo2RERERERERERERERERERERERERERERCIsImNoYXJTdGFydCI6MH19fQ",
      ),
    ).toEqual({
      run: "passages",
      bound: {
        matched: 1,
        rank: 0.1,
        key: { sourceDocumentId: "01J6DDDDDDDDDDDDDDDDDDDDDD", charStart: 0 },
      },
    });
  });
});
