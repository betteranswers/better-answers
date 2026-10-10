import { describe, expect, it } from "vitest";

import { writeConcept } from "@better-answers/core/concepts";
import { head, initRepository } from "@better-answers/core/store/git";
import { documentLanded, type DocumentShape } from "@better-answers/core/testing/documents";

import { connectAsHost } from "./flow.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import { actingIn, openTestGit } from "./harness.ts";
import { calledTool, rpcListOf, rpcOf, structured, type Rpc } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";
import { NO_SESSION_ANSWERED, refusalOfCall, webClientOf, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const QUERY = "heron";

const NESTING = "Heron nesting season";
const FEEDING = "Heron feeding grounds";
const SURVEY = "Heron survey dates";
const RINGING = "Heron ringing records";

const MALFORMED = { data: { httpStatus: 400, refusal: { word: "malformed", class: "malformed" } } };

/** Four concepts naming herons, the last Restricted, in a workspace with a Viewer. */
const aWorkspaceOfHerons = async () => {
  const workspace = await app().provision();
  const viewer = await app().person();
  await app().addMember(workspace.workspaceId, viewer.id, "Viewer");
  const { concepts } = await seedConcepts(
    app(),
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        {
          title: NESTING,
          body: "Herons nest on the synthetic reservoir island from March.",
          trust: "machine-confirmed",
        },
        { title: FEEDING, body: "The heron feeds along the synthetic eastern shallows." },
        { title: SURVEY, body: "Heron counts on the synthetic reservoir are taken each June." },
        {
          title: RINGING,
          body: "Ringed heron records are kept by the synthetic warden.",
          sensitivity: "Restricted",
        },
      ],
    }),
  );
  const iriOf = (title: string): string => {
    const seeded = concepts.find((concept) => concept.title === title);
    if (seeded === undefined) throw new Error(`${title} was not seeded`);
    return seeded.iri;
  };
  return { workspace, viewer, iriOf };
};

/** The MCP edge names a verifier's keys its own way; core's are what the web reads. */
const inCoresKeys = (hit: Rpc): Rpc => {
  if (hit["trust"] === undefined) return hit;
  const { checkedBy, checkedAt, ...trust } = rpcOf(hit["trust"]);
  return { ...hit, trust: { ...trust, verifiedBy: checkedBy, verifiedAt: checkedAt } };
};

const mcpFoundBy = async (person: { readonly email: string }, args: Rpc) => {
  const client = app().client();
  const { accessToken } = await connectAsHost(app(), client, person, {
    scope: "knowledge:read offline_access",
  });
  const { hits, ...found } = structured(await calledTool(client, accessToken, "find", args));
  return { ...found, matches: rpcListOf(hits).map(inCoresKeys) };
};

describe("knowledge.find over tRPC", () => {
  it("answers MCP find's first page at the same limit", async () => {
    const { workspace } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const page = await api.knowledge.find.query({ query: QUERY, limit: 2 });

    expect(page.nextCursor).toBeDefined();
    expect(page).toEqual(await mcpFoundBy(workspace.admin, { query: QUERY, limit: 2 }));
  });

  it("pages through nextCursor to the end, repeating no match", async () => {
    const { workspace, iriOf } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const first = await api.knowledge.find.query({ query: QUERY, limit: 3 });
    const last = await api.knowledge.find.query({
      query: QUERY,
      limit: 3,
      cursor: first.nextCursor,
    });
    const whole = await api.knowledge.find.query({ query: QUERY, limit: 20 });

    expect(last.nextCursor).toBeUndefined();
    expect([...first.matches, ...last.matches]).toEqual(whole.matches);
    expect(
      whole.matches.map((match) => (match.layer === "bundles" ? match.iri : match.locator)),
    ).toEqual(expect.arrayContaining([NESTING, FEEDING, SURVEY, RINGING].map(iriOf)));
    expect(whole.matches).toHaveLength(4);
  });

  it.each([
    ["no match", 0, "too-small"],
    ["more than 20 matches", 21, "too-big"],
  ])("refuses a page of %s as malformed", async (_, limit, issue) => {
    const { workspace } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const refused = await refusalOfCall(api.knowledge.find.query({ query: QUERY, limit }));

    expect(refused).toMatchObject({ data: { refusal: { fields: { limit: issue } } } });
    expect(refused).toMatchObject(MALFORMED);
  });

  it("refuses a query holding U+0000 as malformed, not failed", async () => {
    const { workspace } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const refused = await refusalOfCall(api.knowledge.find.query({ query: "heron\u0000" }));

    expect(refused).toMatchObject({ data: { refusal: { fields: { query: "refused" } } } });
    expect(refused).toMatchObject(MALFORMED);
  });

  it("answers each concept match's trust words as text", async () => {
    const { workspace } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const page = await api.knowledge.find.query({ query: QUERY, limit: 20 });

    expect(
      page.matches.flatMap((match) =>
        match.layer === "bundles" ? [[match.title, match.trustWords]] : [],
      ),
    ).toEqual(
      expect.arrayContaining([
        [NESTING, "Verified automatically"],
        [FEEDING, "Unverified"],
        [SURVEY, "Unverified"],
        [RINGING, "Unverified"],
      ]),
    );
  });
});

describe("knowledge.open over tRPC", () => {
  it("answers the read by IRI, its trust words as text", async () => {
    const { viewer, iriOf } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), viewer.email);

    const opened = await api.knowledge.open.query({ iri: iriOf(NESTING) });

    expect(opened).toMatchObject({
      found: true,
      concept: {
        iri: iriOf(NESTING),
        frontmatter: { title: NESTING },
        trust: { tier: "machine-confirmed", status: "current" },
        trustWords: "Verified automatically",
      },
    });
  });

  it("refuses a malformed IRI as malformed", async () => {
    const { viewer } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), viewer.email);

    const refused = await refusalOfCall(api.knowledge.open.query({ iri: "a heron" }));

    expect(refused).toMatchObject({ data: { refusal: { fields: { iri: expect.any(String) } } } });
    expect(refused).toMatchObject(MALFORMED);
  });

  it("answers an absent and a withheld concept the same NOT_FOUND", async () => {
    const { viewer, iriOf } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), viewer.email);
    const absentIri = "https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ";

    const withheld = rpcOf(await refusalOfCall(api.knowledge.open.query({ iri: iriOf(RINGING) })));
    const absent = rpcOf(await refusalOfCall(api.knowledge.open.query({ iri: absentIri })));

    expect(withheld).toMatchObject({
      message: "not-found",
      data: { code: "NOT_FOUND", httpStatus: 404, refusal: { word: "not-found", class: "absent" } },
    });
    expect([withheld["message"], withheld["data"]]).toEqual([absent["message"], absent["data"]]);
    expect(JSON.stringify(withheld)).not.toContain(RINGING);
  });

  it("carries the pane's access, lead and next words beside evidence", async () => {
    const { iri, handbook, minutes, viewer, admin } = await aConceptCitingRestrictedMinutes();

    const opened = await (await webSignedIn(app(), viewer.email)).api.knowledge.open.query({ iri });
    const seen = await (await webSignedIn(app(), admin.email)).api.knowledge.open.query({ iri });

    expect(opened).toMatchObject({
      concept: {
        access: "partly-included",
        lead: "Based on your current access, some of the evidence isn't included.",
        next: "Ask an Admin for access to the sources, or read the concept as it stands.",
        evidence: [
          { id: "HANDBOOK", source: HANDBOOK_TITLE, locator: handbook },
          { id: "MINUTES", source: MINUTES_LABEL },
        ],
      },
    });
    expect(seen).toMatchObject({
      concept: {
        access: "included",
        lead: "Based on your current access, the evidence is included.",
        next: "Open a source to read the passage the concept rests on.",
        evidence: [
          { id: "HANDBOOK", source: HANDBOOK_TITLE, locator: handbook },
          { id: "MINUTES", source: MINUTES_LABEL, locator: minutes },
        ],
      },
    });
  });
});

const HANDBOOK_TITLE = "The synthetic heron handbook";
const MINUTES_LABEL = "Warden minutes";

/** A concept citing an Internal handbook passage and a Restricted one of minutes, with a Viewer. */
const aConceptCitingRestrictedMinutes = async () => {
  const workspace = await app().provision();
  const { workspaceId, admin } = workspace;
  const viewer = await app().person();
  await app().addMember(workspaceId, viewer.id, "Viewer");
  const landed = (shape: DocumentShape) =>
    documentLanded(app().database.superuser, workspaceId, shape);
  const handbook = await landed({ title: HANDBOOK_TITLE, text: "Herons nest from March." });
  const minutes = await landed({
    title: "Synthetic warden minutes, March",
    text: "The warden rings the herons each spring.",
    sensitivity: "Restricted",
  });
  const git = openTestGit(app());
  await initRepository(git, workspaceId);
  const writer = await actingIn(app(), { workspaceId, userId: admin.id }, async (held) => held);
  const written = await writeConcept(
    writer,
    { git, postgres: app().doors.postgres, clock: app().doors.clock },
    {
      mergeKey: "note:heron-nesting",
      path: "knowledge/heron-nesting.md",
      kind: "Note",
      title: NESTING,
      frontmatter: {
        title: NESTING,
        type: "Note",
        sources: [
          {
            id: "HANDBOOK",
            title: HANDBOOK_TITLE,
            resource: "handbook",
            locator: handbook.locator,
          },
          { id: "MINUTES", title: MINUTES_LABEL, resource: "minutes", locator: minutes.locator },
        ],
      },
      body: "Herons nest from March.[^HANDBOOK] The warden rings them.[^MINUTES]\n",
      message: "Record the heron nesting season",
      author: { name: admin.name, email: admin.email },
      expects: { head: await head(writer, git) },
      status: "stable",
      evidence: [
        { sourceDocumentId: handbook.documentId, locator: handbook.locator, resource: "handbook" },
      ],
    },
  );
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return {
    iri: written.value.iri,
    handbook: handbook.locator,
    minutes: minutes.locator,
    viewer,
    admin,
  };
};

describe("the knowledge router, signed out", () => {
  it("refuses find and open with no session", async () => {
    const { api } = webClientOf(app().client());

    const found = await refusalOfCall(api.knowledge.find.query({ query: QUERY }));
    const opened = await refusalOfCall(
      api.knowledge.open.query({ iri: "https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ" }),
    );

    expect(found).toMatchObject({ data: { httpStatus: 401, ...NO_SESSION_ANSWERED.error.data } });
    expect(opened).toMatchObject({ data: { httpStatus: 401, ...NO_SESSION_ANSWERED.error.data } });
  });
});
