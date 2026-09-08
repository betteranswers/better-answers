import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { writeConcept } from "@better-answers/core/concepts";
import type { UserPrincipal } from "@better-answers/core/kernel";
import { initRepository, openGit } from "@better-answers/core/store/git";
import { openPostgres, withPrincipal } from "@better-answers/core/store/postgres";
import { testData } from "@better-answers/schema/testing";

import { connectAsHost } from "./flow.ts";
import { startApp, type TestApp, type TestClient } from "./harness.ts";

/**
 * The invisibility criterion through the highest surface that exists (T-055; T-006 spec,
 * *Testing Decisions* seam 2): a concept written **through the governed write**, citing a
 * document under a Restricted binding, is invisible to a Viewer through `find`, `ask` and
 * `open` by IRI on the MCP surface — with a token the real flow minted — indistinguishably
 * from one that never existed: no hit, no count, no hint, and `open`'s refusal the same
 * shape as not-found. The Admin's token, which may see it, is the proof it is there. The
 * graph walk and the footnote read are proved at the slice seam
 * (`packages/core/test/invisibility.test.ts`).
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
  const git = openGit(app.gitStoreDir);
  await initRepository(git, workspace.workspaceId);
  const written = await writeConcept(
    await principalFor(workspace.workspaceId, workspace.admin.id),
    { git, postgres: openPostgres(app.database.pool) },
    {
      mergeKey: "note:board-remuneration",
      path: "knowledge/board-remuneration.md",
      kind: "Note",
      title: TITLE,
      frontmatter: { title: TITLE, type: "Note" },
      body: "The board's remuneration is reviewed each March.",
      message: "Record the board's remuneration note",
      author: { name: workspace.admin.name, email: workspace.admin.email },
      expects: { head: null },
      status: "stable",
      evidence: [{ sourceDocumentId: documentId, locator: "p.4", resource: "Board minutes" }],
    },
  );
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  const tokenFor = async (person: { readonly email: string }) =>
    (await connectAsHost(app, app.client(), person, { scope: "knowledge:read offline_access" }))
      .accessToken;
  return {
    iri: written.value.iri,
    viewer: { client: app.client(), token: await tokenFor(viewer) },
    admin: { client: app.client(), token: await tokenFor(workspace.admin) },
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
