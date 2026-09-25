import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { writeConcept } from "@better-answers/core/concepts";
import type { UserPrincipal } from "@better-answers/core/kernel";
import { initRepository } from "@better-answers/core/store/git";
import {
  codePointsOf,
  documentLanded,
  groupSeeded,
  type DocumentShape,
} from "@better-answers/core/testing/documents";
import { testData } from "@better-answers/schema/testing";

import { connectAsHost } from "./flow.ts";
import { actingIn, openTestGit, startApp, type TestApp } from "./harness.ts";
import { calledTool as called, rendered, rpcListOf, rpcOf, structured } from "./mcp-call.ts";

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app.stop();
});

const principalFor = (workspaceId: string, userId: string): Promise<UserPrincipal> =>
  actingIn(app, { workspaceId, userId }, async (principal) => principal);

const TITLE = "Board remuneration";

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
    { git, postgres: app.doors.postgres, clock: app.doors.clock },
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

const clientAndTokenFor = async (person: { readonly email: string }) => ({
  client: app.client(),
  token: (
    await connectAsHost(app, app.client(), person, { scope: "knowledge:read offline_access" })
  ).accessToken,
});

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
  it("is no hit through find, though the Admin finds it", async () => {
    const { iri, viewer, admin } = await restrictedSourcedConcept();

    const found = await called(viewer.client, viewer.token, "find", { query: "remuneration" });
    const seen = await called(admin.client, admin.token, "find", { query: "remuneration" });

    expect(structured(found)).toEqual({ query: "remuneration", hits: [] });
    expect(rendered(found)).toBe("Nothing in the company's knowledge matches that.");
    expect(rpcListOf(structured(seen)["hits"]).map((hit) => hit["iri"])).toEqual([iri]);
  });

  it("is absent from ask's answer, though cited in the Admin's", async () => {
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

    expect(structured(seen)).toMatchObject({ verdict: "refuse", citations: [{ iri }] });
    expect(rendered(seen)).toContain(iri);
  });

  it("opens as an unminted IRI, though the Admin opens it", async () => {
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

const QUERY = "kingfisher";
const INVOICE_TITLE = "The bid library's invoice";
const INVOICE_TEXT = "The kingfisher invoice was settled in March.";
const COVERED_TITLE = "The covered handbook";
const COVERED_TEXT = "The kingfisher handbook explains the rule.";
const COVERING_TITLE = "Kingfisher policy";

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

describe("the document layer through the MCP entries", () => {
  it("previews a document as its layer's hit, skipping covered ones", async () => {
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

    expect(rendered(found)).toBe(
      [
        `Note · ${COVERING_TITLE} · Unchecked · ${iri}`,
        `document · ${INVOICE_TITLE} · Not company knowledge · Internal · ${standalone.locator}`,
      ].join("\n"),
    );
    expect(JSON.stringify(found)).not.toContain(COVERED_TITLE);
  });

  it("opens a wire locator's passage, with its document and sensitivity", async () => {
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

  it("answers every unreachable locator with the one word and shape", async () => {
    const { standalone, underReview, elsewhere, viewer } = await documentsAndTheConceptOverThem();
    const nonsense = "not an address at all";
    const pastTheEnd = `${standalone.documentId}/chars:0-${codePointsOf(INVOICE_TEXT) + 1}`;

    const [outside, review, malformed, tooFar] = await Promise.all([
      called(viewer.client, viewer.token, "open", { locator: elsewhere.locator }),
      called(viewer.client, viewer.token, "open", { locator: underReview.locator }),
      called(viewer.client, viewer.token, "open", { locator: nonsense }),
      called(viewer.client, viewer.token, "open", { locator: pastTheEnd }),
    ]);

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

  it("renders each evidence item's wire locator, which opens its passage", async () => {
    const { iri, covered, viewer } = await documentsAndTheConceptOverThem();

    const concept = await called(viewer.client, viewer.token, "open", { iri });

    expect(rpcOf(structured(concept)["concept"])["evidence"]).toEqual([
      { locator: covered.locator, source: COVERED_TITLE },
    ]);
    expect(rendered(concept)).toContain(`- ${COVERED_TITLE} (${covered.locator})`);

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
