import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { overrideConceptSensitivity, writeConcept } from "@better-answers/core/concepts";
import type { UserPrincipal } from "@better-answers/core/kernel";
import { head, initRepository } from "@better-answers/core/store/git";
import {
  codePointsOf,
  documentLanded,
  groupSeeded,
  type DocumentShape,
} from "@better-answers/core/testing/documents";
import { passageLocatorOf, ULID } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { matching } from "@better-answers/schema/testing/matching";

import { connectAsHost } from "../support/flow.ts";
import { actingIn, openTestGit, startApp, type TestApp } from "../support/harness/harness.ts";
import {
  calledTool as called,
  rendered,
  rpcListOf,
  rpcOf,
  structured,
} from "../support/mcp-call.ts";

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

const CONCEPT_PREFIX = "https://better-answers.com/c/";

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
  const writer = await principalFor(workspace.workspaceId, workspace.admin.id);
  const written = await writeConcept(
    writer,
    { git, postgres: app.doors.postgres, clock: app.doors.clock },
    {
      kind: "Note",
      author: { name: workspace.admin.name, email: workspace.admin.email },
      expects: { head: await head(writer, git) },
      status: "stable",
      ...write,
    },
  );
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return written.value.iri;
};

const widenToEveryone = (workspace: Awaited<ReturnType<TestApp["provision"]>>, iri: string) =>
  actingIn(app, { workspaceId: workspace.workspaceId, userId: workspace.admin.id }, (admin, tx) =>
    overrideConceptSensitivity(admin, tx, { iri, sensitivity: "Internal", audience: "everyone" }),
  );

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
    const connectedSource = await seed.connectedSource({
      workspaceId: workspace.workspaceId,
      sensitivity: "Restricted",
    });
    documentId = (
      await seed.sourceDocument({
        workspaceId: workspace.workspaceId,
        connectedSourceId: connectedSource.id,
      })
    ).id;
  } finally {
    client.release();
  }
  const iri = await conceptWrittenIn(workspace, {
    mergeKey: "note:board-remuneration",
    path: "knowledge/board-remuneration.md",
    title: TITLE,
    frontmatter: {
      title: TITLE,
      type: "Note",
      sources: [{ resource: "Board minutes", locator: passageLocatorOf(documentId, 0, 1) }],
    },
    body: "The board's remuneration is reviewed each March.",
    message: "Record the board's remuneration note",
  });
  return {
    iri,
    viewer: await clientAndTokenFor(viewer),
    admin: await clientAndTokenFor(workspace.admin),
  };
};

const REMUNERATION_QUESTION = { question: "How is the board's remuneration reviewed?" };

describe("a concept from a Restricted document, read by a Viewer", () => {
  it("is absent from the Viewer's find, not the Admin's", async () => {
    const { iri, viewer, admin } = await restrictedSourcedConcept();

    const found = await called(viewer.client, viewer.token, "find", { query: "remuneration" });
    const seen = await called(admin.client, admin.token, "find", { query: "remuneration" });

    expect(structured(found)).toEqual({ query: "remuneration", hits: [] });
    expect(rendered(found)).toBe("Nothing in the company's knowledge matches that.");
    expect(rpcListOf(structured(seen)["hits"]).map((match) => match["iri"])).toEqual([iri]);
  });

  describe("through ask", () => {
    let seeded: Awaited<ReturnType<typeof restrictedSourcedConcept>>;

    beforeAll(async () => {
      seeded = await restrictedSourcedConcept();
    });

    it("answers the Viewer like an unrelated question, except record ids", async () => {
      const { viewer } = seeded;

      const asked = await called(viewer.client, viewer.token, "ask", REMUNERATION_QUESTION);
      const unrelated = await called(viewer.client, viewer.token, "ask", {
        question: "Is the sky blue?",
      });
      const { recordId, ...answer } = structured(asked);
      const { recordId: unrelatedRecordId, ...unrelatedAnswer } = structured(unrelated);

      expect(answer).toMatchObject({ verdict: "refuse", related: [], collections: [] });
      expect(answer).toEqual(unrelatedAnswer);
      expect([recordId, unrelatedRecordId]).toEqual([
        matching.stringMatching(ULID),
        matching.stringMatching(ULID),
      ]);
      expect(recordId).not.toBe(unrelatedRecordId);
      expect(rendered(asked).replace(String(recordId), String(unrelatedRecordId))).toBe(
        rendered(unrelated),
      );
      expect(JSON.stringify(asked)).not.toContain("remuneration is reviewed");
      expect(JSON.stringify(asked)).not.toContain("better-answers.com/c/");
    });

    it("is cited to the Admin with its app page URL", async () => {
      const { iri, admin } = seeded;

      const seen = await called(admin.client, admin.token, "ask", REMUNERATION_QUESTION);

      const page = `https://app.example.test/knowledge/search/${iri.slice(CONCEPT_PREFIX.length)}`;
      expect(structured(seen)).toMatchObject({
        verdict: "related",
        judgeState: "not-judged",
        related: [
          {
            iri,
            url: page,
            kind: "Note",
            title: TITLE,
            collection: null,
            trust: { tier: "unverified", status: "current", checkedBy: null, checkedAt: null },
          },
        ],
      });
      expect(rendered(seen)).toContain(iri);
      expect(rendered(seen)).not.toContain(page);
    });
  });

  it("opens for the Admin but answers the Viewer as missing", async () => {
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

const seedDocumentsAndCoveringConcept = async () => {
  const workspace = await app.provision();
  const viewer = await app.person();
  await app.addMember(workspace.workspaceId, viewer.id, "Viewer");
  const landing = (shape: DocumentShape) =>
    documentLanded(app.database.superuser, workspace.workspaceId, shape);

  const standalone = await landing({ title: INVOICE_TITLE, text: INVOICE_TEXT });
  const covered = await landing({ title: COVERED_TITLE, text: COVERED_TEXT });
  const underReview = await landing({
    title: "The connected source still under review",
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
    path: "knowledge/policies/kingfisher-policy.md",
    title: COVERING_TITLE,
    frontmatter: {
      title: COVERING_TITLE,
      type: "Note",
      sources: [{ resource: COVERED_TITLE, locator: covered.locator, title: COVERED_TITLE }],
    },
    body: "The kingfisher rule is stated here.",
    message: "Record the kingfisher policy",
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

describe("documents through the MCP find and open entries", () => {
  it("lists uncovered documents after concepts and omits covered documents", async () => {
    const { iri, standalone, viewer } = await seedDocumentsAndCoveringConcept();

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
        trustWords: "Unverified",
        collection: "policies",
        tags: [],
      },
      {
        layer: "sources",
        kind: "document",
        title: INVOICE_TITLE,
        locator: standalone.locator,
        sensitivity: "Internal",
        openingLine: INVOICE_TEXT,
      },
    ]);

    expect(rendered(found)).toBe(
      [
        `Note · ${COVERING_TITLE} · policies · Unverified · ${iri}`,
        `document · ${INVOICE_TITLE} · Not company knowledge · Internal · ${standalone.locator} · "${INVOICE_TEXT}"`,
      ].join("\n"),
    );
    expect(JSON.stringify(found)).not.toContain(COVERED_TITLE);
  });

  it("pages with nextCursor, returning each match once, then no cursor", async () => {
    const { iri, standalone, viewer } = await seedDocumentsAndCoveringConcept();

    const first = await called(viewer.client, viewer.token, "find", { query: QUERY, limit: 1 });
    const cursor = structured(first)["nextCursor"];
    const second = await called(viewer.client, viewer.token, "find", {
      query: QUERY,
      limit: 1,
      cursor,
    });

    expect(structured(first)).toEqual({
      query: QUERY,
      hits: [matching.objectContaining({ layer: "bundles", iri, title: COVERING_TITLE })],
      nextCursor: matching.stringMatching(/^[\w-]+$/),
    });
    expect(rendered(first)).toBe(
      [
        `Note · ${COVERING_TITLE} · policies · Unverified · ${iri}`,
        "",
        `There are more matches. To get them, call find again with cursor ${String(cursor)}`,
      ].join("\n"),
    );
    expect(structured(second)).toEqual({
      query: QUERY,
      hits: [
        {
          layer: "sources",
          kind: "document",
          title: INVOICE_TITLE,
          locator: standalone.locator,
          sensitivity: "Internal",
          openingLine: INVOICE_TEXT,
        },
      ],
    });
  });

  it("opens a passage by locator with its title and sensitivity", async () => {
    const { standalone, viewer } = await seedDocumentsAndCoveringConcept();

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

  it("answers every unreachable locator with the same not-found shape", async () => {
    const { standalone, underReview, elsewhere, viewer } = await seedDocumentsAndCoveringConcept();
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

  it("renders each evidence locator, and that locator opens the passage", async () => {
    const { iri, covered, viewer } = await seedDocumentsAndCoveringConcept();

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

const VERIFIED_TITLE = "Heron policy";
const VERIFIED_AT = "2026-06-01T09:30:00.000Z";

describe("a verified concept in MCP find and open", () => {
  it("returns its verifier and date as checkedBy and checkedAt", async () => {
    const workspace = await app.provision();
    const iri = await conceptWrittenIn(workspace, {
      mergeKey: "note:heron-policy",
      path: "knowledge/heron-policy.md",
      title: VERIFIED_TITLE,
      frontmatter: { title: VERIFIED_TITLE, type: "Note" },
      body: "The heron rule is stated here.",
      message: "Record the heron policy",
    });
    const client = await app.database.superuser.connect();
    try {
      await testData(client).conceptVerification({
        workspaceId: workspace.workspaceId,
        iri,
        actor: `human:${workspace.admin.id}`,
        origin: "imported",
        contentHash: null,
        verifiedAt: new Date(VERIFIED_AT),
      });
    } finally {
      client.release();
    }
    const reader = await clientAndTokenFor(workspace.admin);
    const trust = {
      tier: "human-reviewed",
      status: "current",
      checkedBy: workspace.admin.name,
      checkedAt: VERIFIED_AT,
      rider: "imported",
    };

    const found = await called(reader.client, reader.token, "find", { query: "heron" });
    const opened = await called(reader.client, reader.token, "open", { iri });

    expect(rpcOf(rpcListOf(structured(found)["hits"])[0])["trust"]).toEqual(trust);
    expect(rpcOf(structured(opened)["concept"])["trust"]).toEqual(trust);
    expect(rendered(opened)).toContain(`Verified by ${workspace.admin.name} · 1 June 2026`);
  });
});

const KINGFISHER_TITLE = "Kingfisher review";
const HANDBOOK_TITLE = "The kingfisher handbook";
const MINUTES_LABEL = "Board minutes";
const MINUTES_TITLE = "Minutes of the board, March 2026";
const MINUTES_TEXT = "The board approved the kingfisher review in closed session.";
const HERON_TITLE = "Heron policy";

const aConceptCitingRestrictedMinutes = async () => {
  const workspace = await app.provision();
  const viewer = await app.person();
  await app.addMember(workspace.workspaceId, viewer.id, "Viewer");
  const handbook = await documentLanded(app.database.superuser, workspace.workspaceId, {
    title: HANDBOOK_TITLE,
    text: COVERED_TEXT,
  });
  const minutes = await documentLanded(app.database.superuser, workspace.workspaceId, {
    title: MINUTES_TITLE,
    text: MINUTES_TEXT,
    sensitivity: "Restricted",
  });
  const heron = await conceptWrittenIn(workspace, {
    mergeKey: "note:heron-policy",
    path: "knowledge/heron-policy.md",
    title: HERON_TITLE,
    frontmatter: {
      title: HERON_TITLE,
      type: "Note",
      sources: [{ resource: "handbook", locator: handbook.locator }],
    },
    body: "The heron rule is stated here.",
    message: "Record the heron policy",
  });
  const body = `The kingfisher review stands. See [${HERON_TITLE}](${heron}).`;
  const iri = await conceptWrittenIn(workspace, {
    mergeKey: "note:kingfisher-review",
    path: "knowledge/kingfisher-review.md",
    title: KINGFISHER_TITLE,
    frontmatter: {
      title: KINGFISHER_TITLE,
      type: "Note",
      sources: [
        { id: "HANDBOOK", title: HANDBOOK_TITLE, resource: "handbook", locator: handbook.locator },
        { id: "MINUTES", title: MINUTES_LABEL, resource: "minutes", locator: minutes.locator },
        { id: "BID", title: "Bid library", resource: "../sources/bid-library.md", locator: "p.4" },
      ],
    },
    body,
    message: "Record the kingfisher review",
  });
  await widenToEveryone(workspace, iri);
  return {
    iri,
    heron,
    body,
    handbook,
    minutes,
    viewer: await clientAndTokenFor(viewer),
    admin: await clientAndTokenFor(workspace.admin),
  };
};

describe("opening a concept that cites Restricted minutes over MCP", () => {
  it("returns the Viewer the full concept, each source by id", async () => {
    const { iri, heron, body, handbook, viewer } = await aConceptCitingRestrictedMinutes();

    const opened = await called(viewer.client, viewer.token, "open", { iri });

    expect(structured(opened)).toEqual({
      found: true,
      concept: {
        iri,
        frontmatter: {
          iri,
          title: KINGFISHER_TITLE,
          type: "Note",
          status: "stable",
          sources: [
            {
              id: "HANDBOOK",
              title: HANDBOOK_TITLE,
              resource: "handbook",
              locator: handbook.locator,
            },
            { id: "MINUTES", title: MINUTES_LABEL, resource: MINUTES_LABEL },
            { id: "BID", title: "Bid library", resource: "Bid library", locator: "p.4" },
          ],
        },
        body,
        relations: [{ kind: "LINKS_TO", target: heron, title: HERON_TITLE }],
        bodyLinks: [{ ordinal: 0, address: heron, target: heron }],
        trust: {
          tier: "unverified",
          status: "current",
          checkedBy: null,
          checkedAt: null,
          rider: null,
        },
        trustWords: "Unverified",
        evidence: [
          { id: "HANDBOOK", source: HANDBOOK_TITLE, locator: handbook.locator },
          { id: "MINUTES", source: MINUTES_LABEL },
          { id: "BID", source: "Bid library", at: "p.4" },
        ],
      },
    });
  });

  it("hides the minutes' locator, id and title from the Viewer", async () => {
    const { iri, minutes, viewer, admin } = await aConceptCitingRestrictedMinutes();

    const opened = await called(viewer.client, viewer.token, "open", { iri });
    const seen = await called(admin.client, admin.token, "open", { iri });

    for (const withheld of [minutes.locator, minutes.documentId, MINUTES_TITLE]) {
      expect(JSON.stringify(structured(opened))).not.toContain(withheld);
      expect(rendered(opened)).not.toContain(withheld);
    }
    expect(JSON.stringify(structured(seen))).toContain(minutes.locator);
  });
});
