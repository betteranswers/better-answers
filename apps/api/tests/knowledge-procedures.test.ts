import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { overrideConceptSensitivity, writeConcept } from "@better-answers/core/concepts";
import { head, initRepository } from "@better-answers/core/store/git";
import { documentLanded, type DocumentShape } from "@better-answers/core/testing/documents";
import { testData } from "@better-answers/schema/testing";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { connectAsHost, signIn } from "./flow.ts";
import {
  conceptIndexSeeding,
  conceptsSeeding,
  seedConceptIndex,
  seedConcepts,
} from "./harness-knowledge.ts";
import { actingIn, openTestGit } from "./harness.ts";
import { calledTool, rendered, rpcListOf, rpcOf, structured, type Rpc } from "./mcp-call.ts";
import { appForSuite, aStoppableClock } from "./suite-app.ts";
import {
  NO_SESSION_ANSWERED,
  refusalOfCall,
  statusOf,
  webClientOf,
  webSignedIn,
} from "./web-client.ts";

const { clock, stopTheClock } = aStoppableClock();

const app = appForSuite({ clock });

const QUERY = "heron";

const ABSENT_IRI = "https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ";

const NESTING = "Heron nesting season";
const FEEDING = "Heron feeding grounds";
const SURVEY = "Heron survey dates";
const RINGING = "Heron ringing records";

const MALFORMED = { data: { httpStatus: 400, refusal: { word: "malformed", class: "malformed" } } };

const aWorkspaceHolding = async (written: readonly Readonly<Record<string, unknown>>[]) => {
  const workspace = await app().provision();
  const viewer = await app().person();
  await app().addMember(workspace.workspaceId, viewer.id, "Viewer");
  const { concepts } = await seedConcepts(
    app(),
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: written,
    }),
  );
  const iriOf = (title: string): string => {
    const seeded = concepts.find((concept) => concept.title === title);
    if (seeded === undefined) throw new Error(`${title} was not seeded`);
    return seeded.iri;
  };
  return { workspace, viewer, iriOf };
};

const FEEDING_WRITTEN = {
  title: FEEDING,
  body: "The heron feeds along the synthetic eastern shallows.",
};

const RINGING_WRITTEN = {
  title: RINGING,
  body: "Ringed heron records are kept by the synthetic warden.",
  sensitivity: "Restricted",
};

const NESTING_BODY = "Herons nest on the synthetic reservoir island from March.";

const aWorkspaceOfHerons = () =>
  aWorkspaceHolding([
    { title: NESTING, body: NESTING_BODY, trust: "machine-confirmed" },
    FEEDING_WRITTEN,
    { title: SURVEY, body: "Heron counts on the synthetic reservoir are taken each June." },
    RINGING_WRITTEN,
  ]);

const aConceptLinkingTwo = () =>
  aWorkspaceHolding([
    FEEDING_WRITTEN,
    RINGING_WRITTEN,
    { title: NESTING, body: NESTING_BODY, linksTo: [FEEDING, RINGING] },
  ]);

const HANDBOOK_TITLE = "The synthetic heron handbook";
const MINUTES_LABEL = "Warden minutes";
const MINUTES_TITLE = "Synthetic warden minutes, March";

const aWorkspaceBeingWritten = async () => {
  const { workspaceId, admin } = await app().provision();
  const git = openTestGit(app());
  await initRepository(git, workspaceId);
  const writer = await actingIn(app(), { workspaceId, userId: admin.id }, async (held) => held);
  const viewer = await app().person();
  await app().addMember(workspaceId, viewer.id, "Viewer");
  const doors = { git, postgres: app().doors.postgres, clock: app().doors.clock };
  return { workspaceId, admin, viewer, git, writer, doors };
};

const aConceptCitingRestrictedMinutes = async () => {
  const { workspaceId, admin, viewer, git, writer, doors } = await aWorkspaceBeingWritten();
  const landed = (shape: DocumentShape) =>
    documentLanded(app().database.superuser, workspaceId, shape);
  const handbook = await landed({ title: HANDBOOK_TITLE, text: "Herons nest from March." });
  const minutes = await landed({
    title: MINUTES_TITLE,
    text: "The warden rings the herons each spring.",
    sensitivity: "Restricted",
  });
  const written = await writeConcept(writer, doors, {
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
  });
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  await actingIn(app(), { workspaceId, userId: admin.id }, (held, tx) =>
    overrideConceptSensitivity(held, tx, {
      iri: written.value.iri,
      sensitivity: "Internal",
      audience: "everyone",
    }),
  );
  return {
    iri: written.value.iri,
    handbook: handbook.locator,
    minutes: minutes.locator,
    minutesDocumentId: minutes.documentId,
    viewer,
    admin,
  };
};

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

  it("answers a Viewer no match for a Restricted concept", async () => {
    const { viewer, iriOf } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), viewer.email);

    const page = await api.knowledge.find.query({ query: QUERY, limit: 20 });

    expect(page.matches.map((match) => (match.layer === "bundles" ? match.iri : ""))).toEqual(
      expect.arrayContaining([NESTING, FEEDING, SURVEY].map(iriOf)),
    );
    expect(JSON.stringify(page)).not.toContain(iriOf(RINGING));
    expect(JSON.stringify(page)).not.toContain(RINGING);
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

const mcpOpenedBy = async (person: { readonly email: string }, iri: string) => {
  const client = app().client();
  const { accessToken } = await connectAsHost(app(), client, person, {
    scope: "knowledge:read offline_access",
  });
  return calledTool(client, accessToken, "open", { iri });
};

const ASKS_THE_BOARD = "Ask [the board](../board.md).";

const threeNotesAskingTheBoard = async () => {
  const { admin, viewer, git, writer, doors } = await aWorkspaceBeingWritten();
  const written = async (
    name: string,
    path: string,
    concept: { readonly title: string; readonly body: string; readonly sensitivity: string },
  ): Promise<string> => {
    const landed = await writeConcept(writer, doors, {
      mergeKey: `note:${name}`,
      path,
      kind: "Note",
      title: concept.title,
      frontmatter: { title: concept.title, type: "Note" },
      body: concept.body,
      message: `Record ${name}`,
      author: { name: admin.name, email: admin.email },
      expects: { head: await head(writer, git) },
      status: "stable",
      sensitivity: concept.sensitivity,
    });
    if (!landed.ok) throw new Error(`the write was refused: ${String(landed.error)}`);
    return landed.value.iri;
  };
  const board = await written("board", "knowledge/held/board.md", {
    title: "The board",
    body: "The board meets in closed session.",
    sensitivity: "Restricted",
  });
  const expenses = { title: "Expenses", body: ASKS_THE_BOARD, sensitivity: "Internal" };
  return {
    admin,
    viewer,
    board,
    notes: [
      await written("held", "knowledge/held/policies/expenses.md", expenses),
      await written("bare", "knowledge/bare/policies/expenses.md", expenses),
      await written("top", "knowledge/expenses.md", expenses),
    ],
  };
};

describe("the knowledge tree over tRPC", () => {
  it("reads the knowledge tree through the knowledge router", async () => {
    const { workspace, viewer } = await aWorkspaceHolding([
      { ...FEEDING_WRITTEN, collection: "birds" },
      { ...RINGING_WRITTEN, collection: "birds" },
      { title: SURVEY, body: "Heron counts are taken each June.", kind: "Procedure" },
    ]);
    await seedConceptIndex(
      app(),
      conceptIndexSeeding.parse({
        workspaceId: workspace.workspaceId,
        batches: [{ collection: "birds", kind: "Answer", count: 60 }],
      }),
    );
    const { api } = await webSignedIn(app(), viewer.email);

    const tree = await api.knowledge.tree.query();
    const first = await api.knowledge.kindConcepts.query({ collection: "birds", kind: "Answer" });
    const rest = await api.knowledge.kindConcepts.query({
      collection: "birds",
      kind: "Answer",
      cursor: first.nextCursor,
    });

    expect(tree).toEqual({
      collections: [
        { collection: "birds", count: 61, kinds: [{ kind: "Answer", count: 61 }] },
        { collection: null, count: 1, kinds: [{ kind: "Procedure", count: 1 }] },
      ],
    });
    expect([first.concepts.length, rest.concepts.length, rest.nextCursor]).toEqual([50, 11, null]);
    expect(first.concepts[0]).toMatchObject({ title: "Answer 01", trustWords: "Unverified" });
    expect(rest.concepts.map(({ title }) => title)).toContain(FEEDING);
  });

  it("refuses a branch naming a collection with a slash", async () => {
    const { viewer } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), viewer.email);

    const refused = await refusalOfCall(
      api.knowledge.kindConcepts.query({ collection: "birds/herons", kind: "Answer" }),
    );
    const answered = await api.knowledge.kindConcepts.query({
      collection: "birds",
      kind: "Answer",
    });

    expect(refused).toMatchObject(MALFORMED);
    expect(answered).toEqual({ concepts: [], nextCursor: null });
  });
});

describe("a body's links over both transports", () => {
  it("answers three unanswerable links alike over MCP", async () => {
    const { admin, viewer, board, notes } = await threeNotesAskingTheBoard();

    const structures: string[] = [];
    const texts: string[] = [];
    for (const iri of notes) {
      const opened = await mcpOpenedBy(viewer, iri);
      structures.push(JSON.stringify(structured(opened)).replaceAll(iri, "this concept"));
      texts.push(rendered(opened));
    }
    const seen = await mcpOpenedBy(admin, notes[0] ?? "");

    expect(structures[0]).toContain('"bodyLinks":[]');
    expect(structures[1]).toBe(structures[0]);
    expect(structures[2]).toBe(structures[0]);
    expect(texts).toEqual(
      notes.map(() => ["# Expenses", "", ASKS_THE_BOARD, "", "_Unverified_"].join("\n")),
    );
    expect(structured(seen)).toMatchObject({
      concept: { bodyLinks: [{ ordinal: 0, address: "../board.md", target: board }] },
    });
  });

  it("answers the same links over MCP and over tRPC", async () => {
    const { viewer, iriOf } = await aConceptLinkingTwo();
    const { api } = await webSignedIn(app(), viewer.email);

    const overTrpc = await api.knowledge.open.query({ iri: iriOf(NESTING) });
    const overMcp = structured(await mcpOpenedBy(viewer, iriOf(NESTING)));

    const answered = [{ ordinal: 0, address: "heron-feeding-grounds.md", target: iriOf(FEEDING) }];
    expect(overTrpc).toMatchObject({ concept: { bodyLinks: answered } });
    expect(overMcp).toMatchObject({ concept: { bodyLinks: answered } });
  });

  it("gives the Viewer no IRI they may not read", async () => {
    const { workspace, viewer, iriOf } = await aConceptLinkingTwo();
    const { api } = await webSignedIn(app(), viewer.email);

    const overTrpc = await api.knowledge.open.query({ iri: iriOf(NESTING) });
    const opened = await mcpOpenedBy(viewer, iriOf(NESTING));
    const seen = await mcpOpenedBy(workspace.admin, iriOf(NESTING));

    const withheld = iriOf(RINGING).slice(-26);
    for (const answer of [JSON.stringify(overTrpc), JSON.stringify(opened)]) {
      expect(answer).not.toContain(withheld);
    }
    expect(rendered(opened).split("\n").slice(-2)).toEqual([
      "Links in the body:",
      `- heron-feeding-grounds.md · ${iriOf(FEEDING)}`,
    ]);
    expect(rendered(seen).split("\n").slice(-3)).toEqual([
      "Links in the body:",
      `- heron-feeding-grounds.md · ${iriOf(FEEDING)}`,
      `- heron-ringing-records.md · ${iriOf(RINGING)}`,
    ]);
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

    const withheld = rpcOf(await refusalOfCall(api.knowledge.open.query({ iri: iriOf(RINGING) })));
    const absent = rpcOf(await refusalOfCall(api.knowledge.open.query({ iri: ABSENT_IRI })));

    expect(withheld).toMatchObject({
      message: "not-found",
      data: { code: "NOT_FOUND", httpStatus: 404, refusal: { word: "not-found", class: "absent" } },
    });
    expect([withheld["message"], withheld["data"]]).toEqual([absent["message"], absent["data"]]);
    expect(JSON.stringify(withheld)).not.toContain(RINGING);
  });

  it("carries the pane's access, lead and next words beside evidence", async () => {
    const { iri, handbook, minutes, minutesDocumentId, viewer, admin } =
      await aConceptCitingRestrictedMinutes();

    const opened = await (await webSignedIn(app(), viewer.email)).api.knowledge.open.query({ iri });
    const seen = await (await webSignedIn(app(), admin.email)).api.knowledge.open.query({ iri });

    expect(opened).toMatchObject({
      concept: {
        access: "partly-included",
        lead: "Based on your current access, some of the evidence isn't included. An Admin shared this concept beyond its evidence.",
        next: "Ask an Admin for access to the sources, or read the concept as it stands.",
        evidence: [
          { id: "HANDBOOK", source: HANDBOOK_TITLE, locator: handbook },
          { id: "MINUTES", source: MINUTES_LABEL },
        ],
      },
    });
    for (const withheld of [minutes, minutesDocumentId, MINUTES_TITLE]) {
      expect(JSON.stringify(opened)).not.toContain(withheld);
    }
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

  it("answers a readable passage by its locator", async () => {
    const { handbook, viewer } = await aConceptCitingRestrictedMinutes();
    const { api } = await webSignedIn(app(), viewer.email);

    const opened = await api.knowledge.open.query({ locator: handbook });

    expect(opened).toEqual({
      found: true,
      passage: {
        locator: handbook,
        source: HANDBOOK_TITLE,
        text: "Herons nest from March.",
        sensitivity: "Internal",
      },
    });
  });

  it("answers an absent and a withheld passage the same NOT_FOUND", async () => {
    const { minutes, viewer } = await aConceptCitingRestrictedMinutes();
    const { api } = await webSignedIn(app(), viewer.email);
    const absentLocator = "01J6ZZZZZZZZZZZZZZZZZZZZZZ/chars:0-5";

    const withheld = rpcOf(await refusalOfCall(api.knowledge.open.query({ locator: minutes })));
    const absent = rpcOf(await refusalOfCall(api.knowledge.open.query({ locator: absentLocator })));

    expect(withheld).toMatchObject({ message: "not-found", data: { httpStatus: 404 } });
    expect([withheld["message"], withheld["data"]]).toEqual([absent["message"], absent["data"]]);
    expect(JSON.stringify(withheld)).not.toContain(MINUTES_TITLE);
  });
});

describe("the knowledge router, signed out", () => {
  it("refuses find and open with no session", async () => {
    const { api } = webClientOf(app().client());

    const found = await refusalOfCall(api.knowledge.find.query({ query: QUERY }));
    const opened = await refusalOfCall(api.knowledge.open.query({ iri: ABSENT_IRI }));

    expect(found).toMatchObject({ data: { httpStatus: 401, ...NO_SESSION_ANSWERED.error.data } });
    expect(opened).toMatchObject({ data: { httpStatus: 401, ...NO_SESSION_ANSWERED.error.data } });
  });
});

const readAt = (procedure: "find" | "open", input: Rpc): string =>
  `${TRPC_ENDPOINT}/knowledge.${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`;

describe("a knowledge read's answer over GET", () => {
  it.each([
    ["a found page", "find", { query: QUERY }, 200],
    ["an absent concept", "open", { iri: ABSENT_IRI }, 404],
  ] as const)("keeps %s out of every cache", async (_, procedure, input, status) => {
    const { workspace } = await aWorkspaceOfHerons();
    const { client } = await webSignedIn(app(), workspace.admin.email);

    const response = await client.fetch(readAt(procedure, input));

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps a signed-out refusal out of every cache", async () => {
    const response = await app()
      .client()
      .fetch(readAt("find", { query: QUERY }));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

const READS_A_MINUTE = 120;

const SHARED_ADDRESS = "203.0.113.118";

const onTheWebAt = async (address: string, email: string) => {
  const client = app().client(address);
  await signIn(app(), client, email);
  return { client, ...webClientOf(client) };
};

describe("the knowledge reads' per-person ceiling", () => {
  it("refuses a person past it while their neighbour reads on", async () => {
    const { workspace, viewer } = await aWorkspaceOfHerons();
    const reader = await onTheWebAt(SHARED_ADDRESS, viewer.email);
    const neighbour = await onTheWebAt(SHARED_ADDRESS, workspace.admin.email);
    stopTheClock();

    const statuses = await Promise.all(
      Array.from({ length: READS_A_MINUTE }, () =>
        statusOf(reader.api.knowledge.find.query({ query: QUERY })),
      ),
    );
    const found = await reader.client.fetch(readAt("find", { query: QUERY }));
    const neighbours = await statusOf(neighbour.api.knowledge.find.query({ query: QUERY }));

    expect(statuses).toEqual(Array.from({ length: READS_A_MINUTE }, () => 200));
    expect(reader.sent.length).toBeLessThan(READS_A_MINUTE);
    expect(found.status).toBe(429);
    const retryAfter = Number(found.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await found.json()).toMatchObject({
      error: { data: { code: "TOO_MANY_REQUESTS", retryAfterSeconds: retryAfter } },
    });
    expect(neighbours).toBe(200);
  });

  it("counts find and open against the one budget", async () => {
    const { viewer, iriOf } = await aWorkspaceOfHerons();
    const { api } = await webSignedIn(app(), viewer.email);
    stopTheClock();

    await Promise.all(
      Array.from({ length: READS_A_MINUTE }, () => api.knowledge.find.query({ query: QUERY })),
    );
    const opened = await refusalOfCall(api.knowledge.open.query({ iri: iriOf(NESTING) }));

    expect(opened).toMatchObject({ data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 } });
  });
});

const aPolicyItsEditorOwns = async () => {
  const { workspaceId, admin, viewer, git, writer, doors } = await aWorkspaceBeingWritten();
  const editor = await app().person();
  await app().addMember(workspaceId, editor.id, "Editor");
  const client = await app().database.superuser.connect();
  try {
    await testData(client).conceptOwner({ workspaceId, collection: "policy", personId: editor.id });
  } finally {
    client.release();
  }
  const written = await writeConcept(writer, doors, {
    mergeKey: "policy:heron-disturbance",
    path: "knowledge/policy/heron-disturbance.md",
    kind: "Policy",
    title: "Heron disturbance",
    frontmatter: { title: "Heron disturbance", type: "Policy" },
    body: "Keep fifty metres from a nesting heron.\n",
    message: "Record the heron disturbance policy",
    author: { name: admin.name, email: admin.email },
    expects: { head: await head(writer, git) },
    status: "stable",
    sensitivity: "Internal",
  });
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  const authorOfHead = () =>
    execFileSync(
      "git",
      ["-C", path.join(git.root, `${workspaceId}.git`), "log", "-1", "--format=%an <%ae>"],
      { encoding: "utf8" },
    ).trim();
  return { iri: written.value.iri, editor, viewer, authorOfHead };
};

describe("an edit saved over tRPC", () => {
  it("signs a save as the signed-in person, never the client", async () => {
    const { iri, editor, authorOfHead } = await aPolicyItsEditorOwns();
    const { api } = await webSignedIn(app(), editor.email);
    const seed = await api.knowledge.conceptToEdit.query({ iri });
    const save = {
      iri,
      parts: { ...seed.parts, body: "Keep a hundred metres from a nesting heron." },
      sources: seed.sources,
      base: seed.base,
    };

    const naming = { ...save, author: { name: "Someone Else", email: "someone@else.invalid" } };

    const forged = await refusalOfCall(api.knowledge.saveConcept.mutate(naming));
    const saved = await api.knowledge.saveConcept.mutate(save);

    expect(forged).toMatchObject(MALFORMED);
    expect(saved).toMatchObject({ outcome: "committed", iri });
    expect(authorOfHead()).toBe(`${editor.name} <${editor.email}>`);
  });

  it("answers each reader's standing beside the concept read", async () => {
    const { iri, editor, viewer } = await aPolicyItsEditorOwns();
    const owner = (await webSignedIn(app(), editor.email)).api;
    const outsider = (await webSignedIn(app(), viewer.email)).api;

    const owners = await owner.knowledge.open.query({ iri });
    const outsiders = await outsider.knowledge.open.query({ iri });

    expect(owners).toMatchObject({ found: true, standing: "commits" });
    expect(outsiders).toMatchObject({ found: true, standing: "suggests" });
  });
});
