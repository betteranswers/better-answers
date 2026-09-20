import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { writeConcept } from "@better-answers/core/concepts";
import { systemClock, type UserPrincipal } from "@better-answers/core/kernel";
import { initRepository } from "@better-answers/core/store/git";
import { openPostgres, withPrincipal } from "@better-answers/core/store/postgres";
import {
  codePointsOf,
  documentLanded,
  groupSeeded,
  type DocumentShape,
} from "@better-answers/core/testing/documents";
import { testData } from "@better-answers/schema/testing";

import { connectAsHost } from "./flow.ts";
import { openTestGit, startApp, type TestApp, type TestClient } from "./harness.ts";

/**
 * The invisibility criterion through the highest surface that exists (T-055; T-006 spec,
 * *Testing Decisions* seam 2): a concept written **through the governed write**, citing a
 * document under a Restricted binding, is invisible to a Viewer through `find`, `ask` and
 * `open` by IRI on the MCP surface — with a token the real flow minted — indistinguishably
 * from one that never existed: no hit, no count, no hint, and `open`'s refusal the same
 * shape as not-found. The Admin's token, which may see it, is the proof it is there. The
 * graph walk and the footnote read are proved at the slice seam
 * (`packages/core/test/invisibility.test.ts`).
 *
 * Beside it, the **document layer** through the same entries (T-134): a document nothing on
 * the map covers previewed as a hit of its own layer and opened by its wire locator, and the
 * four ways a locator answers nothing — withheld, under review, no address, past the end —
 * arriving as the one word in the one shape. The predicate is the sources slice's, applied
 * where T-133 put it; the surface hands the answer over and adds nothing.
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app.stop();
});

type Rpc = Readonly<Record<string, unknown>>;

/** A JSON value narrowed to an object with string keys — the shape every frame and field here is read as. */
const isRpc = (value: unknown): value is Rpc =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The value as an object, or an empty one: a missing field reads as nothing rather than throwing. */
const rpcOf = (value: unknown): Rpc => (isRpc(value) ? value : {});

/** The value's object items, or none. */
const rpcListOf = (value: unknown): readonly Rpc[] =>
  Array.isArray(value) ? value.filter(isRpc) : [];

/**
 * One tool call as a host makes it, and its result — the last frame of a streamed answer,
 * or the JSON body. Written for this suite's three reads alone; the protocol's own
 * conformance is `mcp-surface.test.ts`'s.
 */
const called = async (client: TestClient, token: string, name: string, args: Rpc): Promise<Rpc> => {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("accept", "application/json, text/event-stream");
  headers.set("authorization", `Bearer ${token}`);
  headers.set("mcp-protocol-version", "2025-11-25");
  const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const response = await client.fetch("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(call),
  });
  const text = await response.text();
  const streamed = [...text.matchAll(/^data:(.*)$/gm)].at(-1)?.[1];
  const parsed: unknown = JSON.parse(streamed ?? text);
  const body = rpcOf(parsed);
  expect(body["error"]).toBeUndefined();
  const result = rpcOf(body["result"]);
  expect(result["isError"]).toBeFalsy();
  return result;
};

const structured = (result: Rpc): Rpc => rpcOf(result["structuredContent"]);

const rendered = (result: Rpc): string => String(rpcOf(rpcListOf(result["content"])[0])["text"]);

/** The Principal a transport would resolve for this person, for the act that needs one held. */
const principalFor = async (workspaceId: string, userId: string): Promise<UserPrincipal> => {
  const resolved = await withPrincipal(
    openPostgres(app.database.pool),
    { workspaceId, userId, issuedAt: new Date() },
    async (principal) => principal,
  );
  if (!resolved.ok) throw new Error(`the principal did not resolve: ${resolved.error}`);
  return resolved.value;
};

const TITLE = "Board remuneration";

/**
 * What an arrange still has to say about a concept it writes. The four an arrange never
 * varies are filled here: a Note, by this workspace's Admin, onto an empty head, stable —
 * so every concept these suites stand a proof on is written the one governed way, against a
 * real bare repository, and the class its row carries is the derivation's rather than a
 * value a test chose.
 */
type ConceptWrite = Omit<
  Parameters<typeof writeConcept>[2],
  "kind" | "author" | "expects" | "status"
>;

const conceptWrittenIn = async (
  workspace: Awaited<ReturnType<TestApp["provision"]>>,
  write: ConceptWrite,
): Promise<string> => {
  const git = openTestGit(app);
  await initRepository(git, workspace.workspaceId);
  const written = await writeConcept(
    await principalFor(workspace.workspaceId, workspace.admin.id),
    { git, postgres: openPostgres(app.database.pool), clock: systemClock() },
    {
      kind: "Note",
      author: { name: workspace.admin.name, email: workspace.admin.email },
      expects: { head: null },
      status: "stable",
      ...write,
    },
  );
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return written.value.iri;
};

/** What this person needs to reach the surface as a host does: a client, and a token the real flow minted. */
const clientAndTokenFor = async (person: { readonly email: string }) => ({
  client: app.client(),
  token: (
    await connectAsHost(app, app.client(), person, { scope: "knowledge:read offline_access" })
  ).accessToken,
});

/**
 * The arrange: a workspace, a Viewer in it, a Restricted binding with one document, and a
 * stable concept citing that document — written by the Admin through the governed write
 * against a real bare repository, so the class the row carries is the derivation's.
 */
const restrictedSourcedConcept = async () => {
  const workspace = await app.provision();
  const viewer = await app.person();
  await app.addMember(workspace.workspaceId, viewer.id, "Viewer");
  const client = await app.database.superuser.connect();
  let documentId: string;
  try {
    const seed = testData(client);
    const binding = await seed.sourceBinding({
      workspaceId: workspace.workspaceId,
      sensitivity: "Restricted",
    });
    documentId = (
      await seed.sourceDocument({ workspaceId: workspace.workspaceId, bindingId: binding.id })
    ).id;
  } finally {
    client.release();
  }
  const iri = await conceptWrittenIn(workspace, {
    mergeKey: "note:board-remuneration",
    path: "knowledge/board-remuneration.md",
    title: TITLE,
    frontmatter: { title: TITLE, type: "Note" },
    body: "The board's remuneration is reviewed each March.",
    message: "Record the board's remuneration note",
    evidence: [{ sourceDocumentId: documentId, locator: "p.4", resource: "Board minutes" }],
  });
  return {
    iri,
    viewer: await clientAndTokenFor(viewer),
    admin: await clientAndTokenFor(workspace.admin),
  };
};

describe("a Restricted-sourced concept, to a Viewer's token", () => {
  it("is no hit through find — while the Admin's token finds it", async () => {
    const { iri, viewer, admin } = await restrictedSourcedConcept();

    const found = await called(viewer.client, viewer.token, "find", { query: "remuneration" });
    const seen = await called(admin.client, admin.token, "find", { query: "remuneration" });

    expect(structured(found)).toEqual({ query: "remuneration", hits: [] });
    expect(rendered(found)).toBe("Nothing in the company's knowledge matches that.");
    expect(rpcListOf(structured(seen)["hits"]).map((hit) => hit["iri"])).toEqual([iri]);
  });

  it("reaches no answer through ask — no citation, no passage, no word of it, and nothing an unrelated question would not also get — while the Admin's token is told which concept it rests on", async () => {
    const { iri, viewer, admin } = await restrictedSourcedConcept();
    const question = { question: "How is the board's remuneration reviewed?" };

    const asked = await called(viewer.client, viewer.token, "ask", question);
    const unrelated = await called(viewer.client, viewer.token, "ask", {
      question: "Is the sky blue?",
    });
    const seen = await called(admin.client, admin.token, "ask", question);

    expect(structured(asked)).toMatchObject({
      verdict: "refuse",
      citations: [],
      unmappedPassages: [],
    });
    expect(structured(asked)).toEqual(structured(unrelated));
    expect(rendered(asked)).toBe(rendered(unrelated));
    expect(JSON.stringify(asked)).not.toContain("remuneration is reviewed");
    expect(JSON.stringify(asked)).not.toContain("better-answers.com/c/");
    // The positive control: the concept is there, and a reader who may see it is told so —
    // a refusal still, since nothing drafts an answer yet (B9), naming what it would rest on.
    expect(structured(seen)).toMatchObject({ verdict: "refuse", citations: [{ iri }] });
    expect(rendered(seen)).toContain(iri);
  });

  it("opens exactly as an IRI nobody minted — the same shape, the same words — while the Admin's token opens it", async () => {
    const { iri, viewer, admin } = await restrictedSourcedConcept();
    const absentIri = "https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ";

    const withheld = await called(viewer.client, viewer.token, "open", { iri });
    const absent = await called(viewer.client, viewer.token, "open", { iri: absentIri });
    const seen = await called(admin.client, admin.token, "open", { iri });

    expect(structured(withheld)).toEqual({ found: false, iri });
    expect(structured(absent)).toEqual({ found: false, iri: absentIri });
    expect(rendered(withheld)).toBe(`No concept at ${iri}.`);
    expect(rendered(withheld).replace(iri, absentIri)).toBe(rendered(absent));
    expect(structured(seen)).toMatchObject({ found: true, concept: { iri } });
    expect(rendered(seen)).toContain(TITLE);
  });
});

/**
 * The document layer through the same surface (T-134). The word every arm carries, so one
 * query reaches the concept and the standalone document alike.
 */
const QUERY = "kingfisher";
const INVOICE_TITLE = "The bid library's invoice";
const INVOICE_TEXT = "The kingfisher invoice was settled in March.";
const COVERED_TITLE = "The covered handbook";
const COVERED_TEXT = "The kingfisher handbook explains the rule.";
const COVERING_TITLE = "Kingfisher policy";

/**
 * The arrange for the document layer: a workspace with an Admin and a Viewer, four landed
 * documents — one standing alone, one a visible concept covers, one still under review, one
 * for a group the Viewer is not in — and the concept itself, written through the governed
 * write with the covered document's **wire locator** in its `sources[]`, which is the same
 * string `open` takes.
 */
const documentsAndTheConceptOverThem = async () => {
  const workspace = await app.provision();
  const viewer = await app.person();
  await app.addMember(workspace.workspaceId, viewer.id, "Viewer");
  const landing = (shape: DocumentShape) =>
    documentLanded(app.database.superuser, workspace.workspaceId, shape);

  const standalone = await landing({ title: INVOICE_TITLE, text: INVOICE_TEXT });
  const covered = await landing({ title: COVERED_TITLE, text: COVERED_TEXT });
  const underReview = await landing({
    title: "The binding still under review",
    text: COVERED_TEXT,
    publishedAt: null,
  });
  const groupId = await groupSeeded(app.database.superuser, workspace.workspaceId);
  const elsewhere = await landing({
    title: "The bid team's own file",
    text: COVERED_TEXT,
    audienceGroups: [groupId],
  });

  const iri = await conceptWrittenIn(workspace, {
    mergeKey: "note:kingfisher-policy",
    path: "knowledge/kingfisher-policy.md",
    title: COVERING_TITLE,
    frontmatter: {
      title: COVERING_TITLE,
      type: "Note",
      sources: [{ resource: COVERED_TITLE, locator: covered.locator, title: COVERED_TITLE }],
    },
    body: "The kingfisher rule is stated here.",
    message: "Record the kingfisher policy",
    evidence: [
      { sourceDocumentId: covered.documentId, locator: covered.locator, resource: COVERED_TITLE },
    ],
  });

  return {
    iri,
    standalone,
    covered,
    underReview,
    elsewhere,
    viewer: await clientAndTokenFor(viewer),
  };
};

/**
 * The document layer over MCP (T-134): a search's hit is a union by knowledge layer, and
 * `open` takes the wire locator a hit or a citation carries. The connector applies no
 * predicate of its own — every refusal below is the sources slice's, reached through the
 * same entries the app reads — so what is proved here is that the surface hands them over
 * unchanged, with a token the real flow minted.
 */
describe("the document layer through the MCP entries", () => {
  it("previews a document as a hit of its own layer, marked Not company knowledge, beside the concept — and never a document that concept covers", async () => {
    const { iri, standalone, viewer } = await documentsAndTheConceptOverThem();

    const found = await called(viewer.client, viewer.token, "find", { query: QUERY });

    expect(structured(found)["hits"]).toEqual([
      {
        layer: "bundles",
        iri,
        kind: "Note",
        title: COVERING_TITLE,
        trust: {
          tier: "unverified",
          status: "current",
          checkedBy: null,
          checkedAt: null,
          rider: null,
        },
        bundle: "knowledge",
        tags: [],
      },
      {
        layer: "sources",
        kind: "document",
        title: INVOICE_TITLE,
        locator: standalone.locator,
        sensitivity: "Internal",
      },
    ]);
    // One line per hit, in the reader's words and never the JSON (ADR 0018): the document's
    // carries its kind, its title, the marker, the sensitivity word and the wire locator.
    expect(rendered(found)).toBe(
      [
        `Note · ${COVERING_TITLE} · Unchecked · ${iri}`,
        `document · ${INVOICE_TITLE} · Not company knowledge · Internal · ${standalone.locator}`,
      ].join("\n"),
    );
    expect(JSON.stringify(found)).not.toContain(COVERED_TITLE);
  });

  it("opens the passage at a wire locator, with the document it is in and the word it is held under", async () => {
    const { standalone, viewer } = await documentsAndTheConceptOverThem();

    const opened = await called(viewer.client, viewer.token, "open", {
      locator: standalone.locator,
    });

    expect(structured(opened)).toEqual({
      found: true,
      passage: {
        locator: standalone.locator,
        source: INVOICE_TITLE,
        text: "The kingfisher invoice was settled in March.",
        sensitivity: "Internal",
      },
    });
    expect(rendered(opened)).toBe(
      [
        "> The kingfisher invoice was settled in March.",
        "",
        `— ${INVOICE_TITLE} (${standalone.locator}) · Internal`,
      ].join("\n"),
    );
  });

  it("answers a locator outside the audience, one under review, one that is no address and one past the end of the text with the one word, in the one shape", async () => {
    const { standalone, underReview, elsewhere, viewer } = await documentsAndTheConceptOverThem();
    const nonsense = "not an address at all";
    const pastTheEnd = `${standalone.documentId}/chars:0-${codePointsOf(INVOICE_TEXT) + 1}`;

    const [outside, review, malformed, tooFar] = await Promise.all([
      called(viewer.client, viewer.token, "open", { locator: elsewhere.locator }),
      called(viewer.client, viewer.token, "open", { locator: underReview.locator }),
      called(viewer.client, viewer.token, "open", { locator: nonsense }),
      called(viewer.client, viewer.token, "open", { locator: pastTheEnd }),
    ]);

    // The one shape and the one sentence for all four — a row this reader may not see, a
    // binding nobody has published, a string that is no address and a span past the end of
    // the text — each echoing back only what it was asked with. A reader who could tell any
    // of them apart would learn what the workspace holds by guessing addresses.
    for (const [answer, locator] of [
      [outside, elsewhere.locator],
      [review, underReview.locator],
      [malformed, nonsense],
      [tooFar, pastTheEnd],
    ] as const) {
      expect(structured(answer)).toEqual({ found: false, locator });
      expect(rendered(answer)).toBe(`No passage at ${locator}.`);
    }
  });

  it("renders each evidence item's wire locator when a concept is opened, and opens the passage at it", async () => {
    const { iri, covered, viewer } = await documentsAndTheConceptOverThem();

    const concept = await called(viewer.client, viewer.token, "open", { iri });

    expect(rpcOf(structured(concept)["concept"])["evidence"]).toEqual([
      { locator: covered.locator, source: COVERED_TITLE },
    ]);
    expect(rendered(concept)).toContain(`- ${COVERED_TITLE} (${covered.locator})`);

    // The address the concept handed over is the address the next call opens: one string for
    // a citation and a passage alike (CONTEXT.md, *locator*).
    const passage = await called(viewer.client, viewer.token, "open", {
      locator: covered.locator,
    });

    expect(structured(passage)).toEqual({
      found: true,
      passage: {
        locator: covered.locator,
        source: COVERED_TITLE,
        text: "The kingfisher handbook explains the rule.",
        sensitivity: "Internal",
      },
    });
  });
});
