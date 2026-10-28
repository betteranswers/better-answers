import { assert, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ASK_CAPS,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  TRUST_RIDERS,
  TRUST_STATUSES,
  TRUST_TIERS,
} from "@better-answers/core/answering";
import { groupMemberInput, removeFromGroup } from "@better-answers/core/members";
import {
  THE_OPENING,
  THE_PASSAGE,
  THE_PASSAGE_QUOTED,
  THE_QUERY,
  THE_TITLE,
} from "@better-answers/core/testing/cross-tier";
import { documentLanded, groupSeeded } from "@better-answers/core/testing/documents";
import { inputOf } from "@better-answers/core/testing/input";
import { holdingTable, until, whileActionsWaitAt } from "@better-answers/core/testing/postgres";
import {
  TOOLS_LIST_TTL_CONFIG_KEY,
  TOOLS_LIST_TTL_MS_DEFAULT,
} from "@better-answers/core/workspaces";
import { CONCEPT_BODY_MAX, JUDGE_STATES, QUESTION_VERDICTS, ULID } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import { MCP_TOKEN_RULE, MCP_UNAUTHENTICATED_IP_RULE } from "../../src/auth/constants.ts";
import { connectAsHost } from "../support/flow.ts";
import { conceptsSeeding, seedConcepts } from "../support/harness/harness-knowledge.ts";
import { actingIn, type TestClient } from "../support/harness/harness.ts";
import { calledTool, callMcp, rendered, structured } from "../support/mcp-call.ts";
import {
  changedWhileItWaitsOn,
  landedOrTwoWaitOnALock,
  seededIn,
  waitingOnALock,
  whileTheApiLacks,
} from "../support/provoke.ts";
import { appForSuite, aStoppableClock } from "../support/suite-app.ts";

const { clock, stopTheClock } = aStoppableClock();

const app = appForSuite({ clock });

type Params = Readonly<Record<string, unknown>>;

const rpcError = z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() });
const envelope = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  result: z.unknown().optional(),
  error: rpcError.optional(),
});
type Envelope = z.infer<typeof envelope>;

const tool = z.object({
  name: z.string(),
  description: z.string().optional(),
  annotations: z.looseObject({ readOnlyHint: z.boolean().optional() }).optional(),
  inputSchema: z.looseObject({ properties: z.record(z.string(), z.unknown()).optional() }),
  outputSchema: z.looseObject({}).optional(),
});
type Tool = z.infer<typeof tool>;

const tierOffer = z.object({ const: z.string().optional(), enum: z.array(z.string()).optional() });

const tiersOffered = (schema: unknown): readonly string[] => {
  const tiers = new Set<string>();
  JSON.stringify(schema, (key, value: unknown) => {
    const offer = key === "tier" ? tierOffer.safeParse(value) : undefined;
    if (offer?.success === true) {
      for (const tier of [offer.data.const ?? [], offer.data.enum ?? []].flat()) tiers.add(tier);
    }
    return value;
  });
  return [...tiers];
};

const toolsListed = z.object({
  tools: z.array(tool),
  resultType: z.string().optional(),
  ttlMs: z.number().optional(),
  cacheScope: z.string().optional(),
});

const toolCalled = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
});

const capabilities = z.object({
  tools: z.object({ listChanged: z.boolean().optional() }).optional(),
  resources: z.object({ subscribe: z.boolean().optional() }).optional(),
});

const discovered = z.object({
  supportedVersions: z.array(z.string()),
  capabilities,
  resultType: z.string().optional(),
  ttlMs: z.number().optional(),
  cacheScope: z.string().optional(),
});

const initialised = z.object({ protocolVersion: z.string(), capabilities });

const unsupportedVersion = z.object({ supported: z.array(z.string()) });

const ceilingRefusal = z.object({ error: z.string(), error_description: z.string() });

const MODERN = "2026-07-28";
const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "Anthropic/ClaudeAI", version: "1.0.0" },
};

const withoutEmpty = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ""));

const modern = async (
  client: TestClient,
  token: string,
  method: string,
  params: Params = {},
  overrides: { headers?: Record<string, string>; envelope?: Params | null; version?: string } = {},
): Promise<Response> => {
  const meta = overrides.envelope === undefined ? ENVELOPE : overrides.envelope;
  const headers = withoutEmpty({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "mcp-protocol-version": overrides.version ?? MODERN,
    "mcp-method": method,
    ...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
    ...overrides.headers,
  });
  return client.fetch("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e9),
      method,
      params: meta === null ? params : { ...params, _meta: meta },
    }),
  });
};

const legacy = async (
  client: TestClient,
  token: string,
  method: string,
  params: Params = {},
): Promise<Response> => callMcp(client, token, method, params);

const rpc = async (response: Response): Promise<Envelope> => {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    const frames = (await response.text()).split("\n").filter((line) => line.startsWith("data:"));
    return envelope.parse(JSON.parse(frames.at(-1)?.slice("data:".length) ?? "{}"));
  }
  return envelope.parse(await response.json());
};

const result = async <T>(response: Response, shape: z.ZodType<T>): Promise<T> => {
  const body = await rpc(response);
  expect(body.error).toBeUndefined();
  return shape.parse(body.result);
};

const listTools = async (client: TestClient, token: string): Promise<Tool[]> =>
  (await result(await modern(client, token, "tools/list"), toolsListed)).tools;

const callTool = (client: TestClient, token: string, name: string, args: Params) =>
  modern(client, token, "tools/call", { name, arguments: args });

const firstText = (called: z.infer<typeof toolCalled>): string => called.content[0]?.text ?? "";

const connect = async (scope = "knowledge:read feedback:write offline_access") => {
  const workspace = await app().provision();
  const client = app().client();
  const tokens = await connectAsHost(app(), client, workspace.admin, { scope });
  return { workspace, client, token: tokens.accessToken };
};

const pastTheCeiling = async (max: number, send: () => Promise<Response>) => {
  stopTheClock();
  const letThrough: number[] = [];
  for (let call = 0; call < max; call += 1) letThrough.push((await send()).status);
  const answer = await send();

  const body = ceilingRefusal.safeParse(await answer.json());
  return {
    refusedBefore: letThrough.filter((status) => status === 429).length,
    status: answer.status,
    hasRetryAfter: answer.headers.get("retry-after") !== null,
    sentence: body.success ? body.data.error_description : undefined,
  };
};

const ABSENT = "https://better-answers.com/c/01ARZ3NDEKTSV4RRFFQ69G5FAV";

const relatedCollections = z.object({
  related: z.array(z.object({ collection: z.string().nullable() })),
});

const loggedEvents = (from: number): readonly unknown[] =>
  app()
    .logs.slice(from)
    .map((line) => line["event"]);

const REFUSED_AT_THE_CEILING = {
  refusedBefore: 0,
  status: 429,
  hasRetryAfter: true,
  sentence: matching.stringContaining("an Admin can raise the ceiling in System"),
};

/**
 * Past this Claude Code hands its model a file, not the result. Both copies count: no host says
 * which it counts.
 */
const RESULT_CHARACTERS_CHECKED_UNDER = 50_000;

const PASSAGE_CHARACTERS = 2_000;

const NEAR_THE_BODY_CAP = CONCEPT_BODY_MAX - 1_000;

const aSizedBodyOf = (sentence: string, characters: number): string =>
  sentence.repeat(Math.ceil(characters / sentence.length)).slice(0, characters);

const RETENTION_QUESTION = "How long are audit logs kept?";

const answered = z.object({
  verdict: z.string(),
  related: z.array(z.object({ iri: z.string() })),
  unmappedPassages: z.array(z.object({ locator: z.string() })),
  map: z.object({ state: z.string() }),
  recordId: z.string(),
});

const bodies = z.object({
  related: z.array(z.object({ body: z.string().optional() })),
});

const askedOf = async (client: TestClient, token: string, args: Params) => {
  const called = await result(await callTool(client, token, "ask", args), toolCalled);
  return { called, answer: answered.parse(called.structuredContent) };
};

/** Uncounted, the planner joins every node to every step, and the walk nears its timeout. */
const theMapCounted = async (): Promise<void> => {
  await app().database.superuser.query("ANALYZE map_node, map_edge");
};

const recordsKeptIn = async (workspaceId: string) => {
  const kept = await app().database.superuser.query<{
    id: string;
    transport: string;
    groups: string[];
    verdict: string | null;
    completed: boolean;
  }>(
    `SELECT id, transport, predicate_groups AS groups, verdict,
            completed_at IS NOT NULL AS completed
       FROM question_asked WHERE workspace_id = $1 ORDER BY asked_at, id`,
    [workspaceId],
  );
  return kept.rows;
};

const AN_OPEN_RECORD = {
  id: matching.stringMatching(ULID),
  transport: "mcp",
  groups: [],
  verdict: null,
  completed: false,
};

const connectAViewer = async () => {
  const workspace = await app().provision();
  const viewer = await app().person();
  await app().addMember(workspace.workspaceId, viewer.id, "Viewer");
  const client = app().client();
  const tokens = await connectAsHost(app(), client, viewer, {
    scope: "knowledge:read offline_access",
  });
  return { workspace, viewer, client, token: tokens.accessToken };
};

const theErrorAskAnswers = async (client: TestClient, token: string) => {
  const called = await result(
    await callTool(client, token, "ask", { question: RETENTION_QUESTION }),
    toolCalled,
  );
  return [called.isError, firstText(called), called.structuredContent];
};

describe("era-independent", () => {
  it("lists a full token's four entries, in a stable order", async () => {
    const { client, token } = await connect();

    const lists = await Promise.all([1, 2, 3].map(() => listTools(client, token)));

    expect(lists[0]?.map((listed) => listed.name)).toEqual([
      "find",
      "ask",
      "open",
      "give_feedback",
    ]);
    expect(lists[1]).toEqual(lists[0]);
    expect(lists[2]).toEqual(lists[0]);
  });

  it("hides give_feedback from a read-only token and refuses its call", async () => {
    const { client, token } = await connect("knowledge:read offline_access");

    const names = (await listTools(client, token)).map((listed) => listed.name);
    expect(names).toEqual(["find", "ask", "open"]);

    const refused = await rpc(
      await callTool(client, token, "give_feedback", {
        recordId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        verdict: "flag",
        reason: "wrong",
      }),
    );
    expect(refused).toMatchObject({ error: { code: -32602 } });
    expect(refused).not.toHaveProperty("result");
  });

  it("lists give_feedback as naming the record it stores on", async () => {
    const { client, token } = await connect();

    const entry = (await listTools(client, token)).find(
      (listed) => listed.name === "give_feedback",
    );

    expect(entry?.description).toContain("on the record of that question");
    expect(entry?.description).toContain("`recordId`");
    expect(entry?.description).toContain("a call repeated after a timeout stores it twice");
    expect(entry?.description).not.toContain("one write");
    assert(entry !== undefined, "give_feedback is listed");
    expect(Object.keys({ ...entry.inputSchema.properties })).toEqual([
      "recordId",
      "verdict",
      "reason",
      "note",
      "disputed",
    ]);
  });

  it("annotates every entry: reads read-only, the one write not", async () => {
    const { client, token } = await connect();

    const tools = await listTools(client, token);

    for (const listed of tools) expect(listed.annotations).toBeDefined();
    expect(tools.map((entry) => [entry.name, entry.annotations?.readOnlyHint])).toEqual([
      ["find", true],
      ["ask", true],
      ["open", true],
      ["give_feedback", false],
    ]);
  });

  it("takes no workspace, bundle or tenant argument, mirroring no headers", async () => {
    const { client, token } = await connect();

    for (const entry of await listTools(client, token)) {
      const keys = Object.keys({ ...entry.inputSchema.properties });
      for (const key of keys) {
        expect(key.toLowerCase()).not.toMatch(/workspace|bundle|tenant/);
      }
      expect(JSON.stringify(entry.inputSchema)).not.toContain("x-mcp-header");
    }
  });

  it.each([
    ["find", "trust status", TRUST_STATUSES],
    ["find", "trust rider", TRUST_RIDERS],
    ["ask", "verdict", QUESTION_VERDICTS],
    ["ask", "judge state", JUDGE_STATES],
    ["open", "trust status", TRUST_STATUSES],
    ["open", "trust rider", TRUST_RIDERS],
    ["give_feedback", "verdict", FEEDBACK_VERDICTS],
    ["give_feedback", "flag reason", FEEDBACK_REASONS],
  ])("offers %s every %s core declares", async (name, _set, values) => {
    const { client, token } = await connect();

    const entry = (await listTools(client, token)).find((listed) => listed.name === name);

    expect(JSON.stringify([entry?.inputSchema, entry?.outputSchema])).toContain(
      `"enum":${JSON.stringify(values)}`,
    );
  });

  it.each(["find", "ask", "open"])("offers %s every trust tier core declares", async (name) => {
    const { client, token } = await connect();

    const entry = (await listTools(client, token)).find((listed) => listed.name === name);

    expect(tiersOffered(entry?.outputSchema).toSorted()).toEqual(TRUST_TIERS.toSorted());
  });

  it("offers open's body links in its output schema", async () => {
    const { client, token } = await connect();

    const entry = (await listTools(client, token)).find((listed) => listed.name === "open");

    expect(JSON.stringify(entry?.outputSchema)).toContain('"bodyLinks"');
    expect(entry?.description).toContain("`bodyLinks` gives the `iri` to open");
  });

  it("describes the two reads in the glossary's words", async () => {
    const { client, token } = await connect();

    const described = new Map(
      (await listTools(client, token)).map((entry) => [entry.name, entry.description]),
    );

    expect(described.get("find")).toContain("Not company knowledge");
    expect(described.get("find")).toContain("`iri`");
    expect(described.get("find")).toContain("locator");
    expect(described.get("open")).toContain("`iri`");
    expect(described.get("open")).toContain("locator");
    expect(described.get("open")).toContain(
      "carries the `locator` of a passage or the `iri` of a concept that opens it only where there is one you may read",
    );
    expect(described.get("open")).toContain("an item with neither has nothing to open");

    expect(described.get("find")).toContain("one line per match");
    expect(described.get("find")?.toLowerCase()).not.toContain("chunk");
  });

  it("answers open as absent in structured content and prose", async () => {
    const { client, token } = await connect();

    const absent = await result(await callTool(client, token, "open", { iri: ABSENT }), toolCalled);

    expect(absent.structuredContent).toEqual({ found: false, iri: ABSENT });
    const text = firstText(absent);
    expect(text).toBe(`No concept at ${ABSENT}.`);
    expect(text).not.toBe(JSON.stringify(absent.structuredContent));
    expect(text.length).toBeLessThan(RESULT_CHARACTERS_CHECKED_UNDER);
  });

  it("finds and opens a landed passage, rendering its stored text", async () => {
    const { workspace, client, token } = await connectAViewer();
    const landed = await documentLanded(app().database.superuser, workspace.workspaceId, {
      title: THE_TITLE,
      text: THE_PASSAGE,
    });

    const found = await calledTool(client, token, "find", { query: THE_QUERY });
    const opened = await calledTool(client, token, "open", { locator: landed.locator });

    expect(structured(found)["hits"]).toEqual([
      {
        layer: "sources",
        kind: "document",
        title: THE_TITLE,
        locator: landed.locator,
        sensitivity: "Internal",
        openingLine: THE_OPENING,
      },
    ]);
    expect(rendered(found)).toBe(
      `document · ${THE_TITLE} · Not company knowledge · Internal · ${landed.locator} · "${THE_OPENING}"`,
    );
    expect(structured(opened)).toEqual({
      found: true,
      passage: {
        locator: landed.locator,
        source: THE_TITLE,
        text: THE_PASSAGE,
        sensitivity: "Internal",
      },
    });
    expect(rendered(opened)).toBe(
      `${THE_PASSAGE_QUOTED}\n\n— ${THE_TITLE} (${landed.locator}) · Internal`,
    );
  });

  it("refuses a malformed iri before open runs", async () => {
    const { client, token } = await connect();
    const before = app().logs.length;

    const refused = await result(
      await callTool(client, token, "open", { iri: "https://better-answers.com/c/01ABSENT" }),
      toolCalled,
    );

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toBeUndefined();
    expect(firstText(refused)).toContain("iri");
    expect(loggedEvents(before)).not.toContain("mcp.refused");
  });

  it("refuses a query holding a NUL, never failing the read", async () => {
    const { client, token } = await connect();
    const before = app().logs.length;

    const refused = await result(
      await callTool(client, token, "find", { query: "audit\u0000logs" }),
      toolCalled,
    );

    expect(refused.isError).toBe(true);
    expect(firstText(refused)).toContain("a query holds no NUL character");
    expect(loggedEvents(before)).not.toContain("mcp.failed");
  });

  it("refuses a question holding a NUL, never failing the read", async () => {
    const { client, token } = await connect();
    const before = app().logs.length;

    const refused = await result(
      await callTool(client, token, "ask", { question: "audit\u0000logs" }),
      toolCalled,
    );

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toBeUndefined();
    expect(firstText(refused)).toContain("a question holds no NUL character");
    expect(loggedEvents(before)).not.toContain("mcp.failed");
  });

  it("keeps ask to the collections its caller names", async () => {
    const { workspace, client, token } = await connect();
    await seedConcepts(
      app(),
      conceptsSeeding.parse({
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        concepts: [
          {
            title: "How long are audit logs kept?",
            collection: "audits",
            body: "Audit logs are kept for thirteen months.",
          },
          {
            title: "How long are audit logs kept in the LMS?",
            collection: "lms",
            body: "The LMS keeps audit logs for a year.",
          },
        ],
      }),
    );
    const collectionsAsked = async (collections?: readonly string[]) => {
      const asked = await result(
        await callTool(client, token, "ask", {
          question: "How long are audit logs kept?",
          collections,
        }),
        toolCalled,
      );
      return relatedCollections
        .parse(asked.structuredContent)
        .related.map((concept) => concept.collection)
        .toSorted();
    };

    expect(await collectionsAsked(["audits"])).toEqual(["audits"]);
    expect(await collectionsAsked()).toEqual(["audits", "lms"]);
  });

  it("refuses a cursor find never handed out", async () => {
    const { client, token } = await connect();

    const refused = await result(
      await callTool(client, token, "find", { query: "audit", cursor: "e30" }),
      toolCalled,
    );

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toBeUndefined();
    expect(firstText(refused)).toContain("not a cursor find handed out");
  });

  it("answers find, ask and give_feedback through the Principal", async () => {
    const { client, token } = await connect();

    const found = await result(
      await callTool(client, token, "find", { query: "accreditation" }),
      toolCalled,
    );
    expect(found.structuredContent).toEqual({ query: "accreditation", hits: [] });

    const asked = await result(
      await callTool(client, token, "ask", { question: "What accreditations do we hold?" }),
      toolCalled,
    );
    expect(asked.structuredContent?.["verdict"]).toBe("refuse");
    expect(firstText(asked)).toMatch(/^\*\*Not answered from the company/);

    const fed = await result(
      await callTool(client, token, "give_feedback", {
        recordId: asked.structuredContent?.["recordId"],
        verdict: "flag",
        reason: "wrong",
      }),
      toolCalled,
    );
    expect(fed.structuredContent?.["outcome"]).toBe("stored");
  });

  it("refuses a revoked person's token, its reason logged, not sent", async () => {
    const { workspace, client, token } = await connect();
    expect((await modern(client, token, "tools/list")).status).toBe(200);

    await app().endEverySignInAndToken(workspace.admin.id, new Date(Date.now() + 1_000));
    const before = app().logs.length;

    const refused = await modern(client, token, "tools/list");
    expect(refused.status).toBe(401);

    const challenge = refused.headers.get("www-authenticate");
    assert(challenge !== null, "the refusal carries a challenge");
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).not.toContain("credentials-revoked");
    expect(app().logs.slice(before)).toContainEqual(
      matching.objectContaining({
        event: "mcp.refused",
        refusal: "credentials-revoked",
        class: "unauthenticated",
      }),
    );
  });

  it("refuses a former member's token, its reason logged, not sent", async () => {
    const { workspace, client, token } = await connect();
    await app().removeMember(workspace.workspaceId, workspace.admin.id);
    const before = app().logs.length;

    const refused = await modern(client, token, "tools/list");

    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).not.toEqual(
      expect.stringContaining("not-a-member"),
    );
    expect(app().logs.slice(before)).toContainEqual(
      matching.objectContaining({
        event: "mcp.refused",
        refusal: "not-a-member",
        class: "unauthenticated",
      }),
    );
  });

  it("refuses a bearer that is not this issuer's", async () => {
    const { client } = await connect();

    const refused = await modern(
      client,
      "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.bm90LWEtc2lnbmF0dXJl",
      "tools/list",
    );

    expect(refused.status).toBe(401);
  });

  it("refuses a token lacking knowledge:read as insufficient scope", async () => {
    const { client, token } = await connect("offline_access");

    const refused = await modern(client, token, "tools/list");

    expect(refused.status).toBe(403);
    expect(refused.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });

  it.each([
    ["both an iri and a locator", { iri: ABSENT, locator: "p.4" }],
    ["neither an iri nor a locator", {}],
  ])("refuses open given %s", async (_case, args) => {
    const { client, token } = await connect();

    const refused = await result(await callTool(client, token, "open", args), toolCalled);

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toBeUndefined();
    expect(firstText(refused)).toContain("give an `iri` or a `locator`, not both and not neither");
  });

  it("answers 429 with one sentence past the token's ceiling", async () => {
    const { client, token } = await connect();

    const refused = await pastTheCeiling(MCP_TOKEN_RULE.max, () =>
      modern(client, token, "tools/list"),
    );

    expect(refused).toEqual(REFUSED_AT_THE_CEILING);
  });
});

describe("ask, on the own-transaction road", () => {
  it("leaves one record, its id the one it answers", async () => {
    const { workspace, client, token } = await connect();

    const { called, answer } = await askedOf(client, token, {
      question: "What accreditations do we hold?",
    });

    expect(answer.recordId).toMatch(ULID);
    expect(await recordsKeptIn(workspace.workspaceId)).toEqual([
      { id: answer.recordId, transport: "mcp", groups: [], verdict: "refuse", completed: true },
    ]);
    expect(firstText(called)).toContain(`Record of this question: ${answer.recordId}`);
  });

  it("is listed read-only, its description naming the record", async () => {
    const { client, token } = await connect();

    const ask = (await listTools(client, token)).find((listed) => listed.name === "ask");

    expect(ask?.annotations?.readOnlyHint).toBe(true);
    expect(ask?.description).toContain(
      "Each question is kept as a record, and the answer carries its `recordId`.",
    );
    expect(ask?.description).toContain(
      "The person who asked and the workspace's Admins may read it.",
    );
    expect(ask?.description).toContain(
      "The question's words are kept for twelve months; the verdict and which concepts were returned are kept for good, and who asked until that person is erased.",
    );
  });

  it("describes each judge state without promising a retry", async () => {
    const { client, token } = await connect();

    const ask = (await listTools(client, token)).find((listed) => listed.name === "ask");

    expect(ask?.description).toContain(
      "`judging-failed` when it could not judge (its candidates are then under `related`)",
    );
    expect(ask?.description).toContain(
      "`not-judged` when the workspace has no judge or no `Answer` was a candidate",
    );
    expect(ask?.description).not.toContain("asking again later");
  });

  describe("refused where the call enters", () => {
    let connected: Awaited<ReturnType<typeof connect>>;

    beforeAll(async () => {
      connected = await connect();
    });

    it.each([
      ["a question holding a NUL", { question: "audit\u0000logs" }],
      ["a question over 2,000 characters", { question: "a".repeat(2_001) }],
      [
        "a question naming 21 collections",
        {
          question: RETENTION_QUESTION,
          collections: Array.from({ length: 21 }, (_, nth) => `collection-${String(nth)}`),
        },
      ],
    ])("keeps no record of %s", async (_case, args) => {
      const { workspace, client, token } = connected;

      const refused = await result(await callTool(client, token, "ask", args), toolCalled);

      expect(refused.isError).toBe(true);
      expect(await recordsKeptIn(workspace.workspaceId)).toEqual([]);
    });
  });

  it("answers from its entry points when the walk times out", async () => {
    const { workspace, client, token } = await connect();
    const { concepts } = await seedConcepts(
      app(),
      conceptsSeeding.parse({
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        concepts: [
          {
            title: "Console exports",
            kind: "Note",
            body: "A spreadsheet can be exported from the console.",
          },
          {
            title: RETENTION_QUESTION,
            body: "Audit logs are kept for thirteen months.",
            linksTo: ["Console exports"],
          },
        ],
      }),
    );
    const [reached, entry] = concepts.map((concept) => concept.iri);
    const before = app().logs.length;

    const stalled = await holdingTable(app().database.superuser, "map_node", () =>
      askedOf(client, token, { question: RETENTION_QUESTION }),
    );
    await theMapCounted();
    const after = await askedOf(client, token, { question: RETENTION_QUESTION });

    expect(loggedEvents(before)).not.toContain("mcp.failed");
    const completed = { transport: "mcp", groups: [], verdict: "related", completed: true };
    expect(await recordsKeptIn(workspace.workspaceId)).toEqual([
      { id: stalled.answer.recordId, ...completed },
      { id: after.answer.recordId, ...completed },
    ]);
    expect([
      stalled.answer.verdict,
      stalled.answer.related.map((concept) => concept.iri),
      stalled.answer.map.state,
    ]).toEqual(["related", [entry], "unavailable_since"]);
    expect(firstText(stalled.called)).toContain("map unavailable since");
    expect([after.answer.related.map((concept) => concept.iri), after.answer.map.state]).toEqual([
      [entry, reached],
      "live",
    ]);
  });

  it.each([
    ["a read fails", "SELECT", "concept_index"],
    ["its completion fails", "UPDATE", "question_asked"],
  ] as const)("leaves its record open when %s", async (_case, privilege, table) => {
    const { workspace, client, token } = await connect();
    const before = app().logs.length;

    const failed = await whileTheApiLacks(app(), privilege, table, () =>
      theErrorAskAnswers(client, token),
    );

    expect(await recordsKeptIn(workspace.workspaceId)).toEqual([AN_OPEN_RECORD]);
    expect(failed).toEqual([true, "ask failed.", undefined]);
    expect(loggedEvents(before)).toContain("mcp.failed");
  });

  it("refuses a call whose asker left a group meanwhile", async () => {
    const { workspace, viewer, client, token } = await connectAViewer();
    const { workspaceId } = workspace;
    const groupId = await groupSeeded(app().database.superuser, workspaceId);
    await seededIn(app(), (seed) => seed.groupMember({ workspaceId, groupId, userId: viewer.id }));
    await documentLanded(app().database.superuser, workspaceId, {
      title: "The bid team's own file",
      text: "Audit logs are kept by the bid team for six years.",
      audienceGroups: [groupId],
    });

    const refused = await changedWhileItWaitsOn(
      app(),
      "question_asked",
      () => theErrorAskAnswers(client, token),
      () =>
        actingIn(app(), { workspaceId, userId: workspace.admin.id }, (admin, tx) =>
          removeFromGroup(admin, tx, inputOf(groupMemberInput, { groupId, userId: viewer.id })),
        ),
    );

    expect(await recordsKeptIn(workspaceId)).toEqual([{ ...AN_OPEN_RECORD, groups: [groupId] }]);
    expect(refused).toEqual([true, "Refused: changed-meanwhile (conflict).", undefined]);
  });

  it("refuses the step after its asker's credentials are revoked", async () => {
    const { workspace, viewer, client, token } = await connectAViewer();

    const refused = await changedWhileItWaitsOn(
      app(),
      "concept_index",
      () => theErrorAskAnswers(client, token),
      () => app().endEverySignInAndToken(viewer.id, new Date(Date.now() + 1_000)),
    );

    expect(await recordsKeptIn(workspace.workspaceId)).toEqual([AN_OPEN_RECORD]);
    expect(refused).toEqual([true, "Refused: credentials-revoked (unauthenticated).", undefined]);
  });

  it("keeps no record of a member gone before its resolve", async () => {
    const { workspace, viewer, client, token } = await connectAViewer();

    const refused = await changedWhileItWaitsOn(
      app(),
      "workspace_config",
      () => theErrorAskAnswers(client, token),
      () => app().removeMember(workspace.workspaceId, viewer.id),
    );

    expect(await recordsKeptIn(workspace.workspaceId)).toEqual([]);
    expect(refused).toEqual([true, "Refused: not-a-member (unauthenticated).", undefined]);
  });

  it.each([
    ["opens its record", "INSERT", false],
    ["completes its record", "UPDATE", true],
  ] as const)("holds the member's removal while it %s", async (_case, write, completed) => {
    const { workspace, viewer, client, token } = await connectAViewer();
    const store = app().database.superuser;
    const landed: string[] = [];

    const waited = await whileActionsWaitAt(store, "question_asked", write, async (release) => {
      const asking = callTool(client, token, "ask", { question: RETENTION_QUESTION });
      await until(async () => (await waitingOnALock(app())) === 1);
      const removing = app()
        .removeMember(workspace.workspaceId, viewer.id)
        .then(() => landed.push("the removal"));
      await until(async () => landedOrTwoWaitOnALock(app(), landed));
      const heldBack = landed.length === 0;
      await release();
      await asking;
      await removing;
      return heldBack;
    });

    expect(waited).toBe(true);
    expect((await recordsKeptIn(workspace.workspaceId)).map((kept) => kept.completed)).toEqual([
      completed,
    ]);
  });

  it("fits the bound at the caps, bodies near their cap", async () => {
    const { workspace, client, token } = await connect();
    const beyondTheEntryPoints = Math.max(0, ASK_CAPS.related - ASK_CAPS.entryPoints);
    const reached = Array.from({ length: beyondTheEntryPoints }, (_, nth) => ({
      title: `Console exports ${String(nth)}`,
      kind: "Note",
      body: aSizedBodyOf("A spreadsheet can be exported from the console. ", NEAR_THE_BODY_CAP),
    }));
    const entries = Array.from({ length: ASK_CAPS.entryPoints }, (_, nth) => ({
      title: `Audit log retention ${String(nth)}`,
      kind: "Policy",
      body: aSizedBodyOf("Audit logs are kept for thirteen months. ", NEAR_THE_BODY_CAP),
      linksTo: reached
        .filter((_entryPoint, place) => place % ASK_CAPS.entryPoints === nth)
        .map((concept) => concept.title),
    }));
    await seedConcepts(
      app(),
      conceptsSeeding.parse({
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        concepts: [...reached, ...entries],
      }),
    );
    for (let nth = 0; nth < ASK_CAPS.unmappedPassages; nth += 1) {
      await documentLanded(app().database.superuser, workspace.workspaceId, {
        title: `Hosting contract ${String(nth)}`,
        text: aSizedBodyOf("Audit logs are kept by the host for ninety days. ", PASSAGE_CHARACTERS),
      });
    }
    await theMapCounted();

    const { called, answer } = await askedOf(client, token, { question: RETENTION_QUESTION });

    expect([answer.related.length, answer.unmappedPassages.length, answer.map.state]).toEqual([
      ASK_CAPS.related,
      ASK_CAPS.unmappedPassages,
      "live",
    ]);
    expect(
      bodies.parse(called.structuredContent).related.filter((concept) => "body" in concept),
    ).toEqual([]);
    expect(JSON.stringify(called).length).toBeLessThan(RESULT_CHARACTERS_CHECKED_UNDER);
  });

  it("returns an `Answer` at the body cap word for word", async () => {
    const { workspace, client, token } = await connect();
    const body = aSizedBodyOf("Audit logs are kept for thirteen months. ", CONCEPT_BODY_MAX - 1);
    await seedConcepts(
      app(),
      conceptsSeeding.parse({
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        concepts: [{ title: "How long are audit logs kept?", body }],
      }),
    );

    const { called } = await askedOf(client, token, { question: RETENTION_QUESTION });

    expect(bodies.parse(called.structuredContent).related.map((concept) => concept.body)).toEqual([
      `${body}\n`,
    ]);
    expect(firstText(called)).toContain(body.trimEnd());
  });
});

describe("a call with no bearer", () => {
  const unauthenticated = (client: TestClient): Promise<Response> =>
    modern(client, "", "tools/list", {}, { headers: { authorization: "" } });

  it("is challenged for the bearer it lacks", async () => {
    const challenged = await unauthenticated(app().client());

    expect(challenged.status).toBe(401);
    expect(challenged.headers.get("www-authenticate")).toContain(
      'error_description="a bearer token is required"',
    );
  });

  it("answers 429 once its address floods the surface", async () => {
    const client = app().client();

    const refused = await pastTheCeiling(MCP_UNAUTHENTICATED_IP_RULE.max, () =>
      unauthenticated(client),
    );

    expect(refused).toEqual(REFUSED_AT_THE_CEILING);
  });
});

describe("a call with a refused bearer", () => {
  it("is refused before the handler, when not a JWT", async () => {
    const client = app().client();
    const before = app().logs.length;

    const refused = await modern(client, "not-a-jwt", "tools/list");

    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(
      app()
        .logs.slice(before)
        .map((line) => line["event"]),
    ).not.toContain("mcp.request");
  });

  it("answers 429 once its address floods the surface", async () => {
    const client = app().client();

    const refused = await pastTheCeiling(MCP_UNAUTHENTICATED_IP_RULE.max, () =>
      modern(client, "not-a-jwt", "tools/list"),
    );

    expect(refused).toEqual(REFUSED_AT_THE_CEILING);
  });
});

describe("the 2026-07-28 leg", () => {
  it("answers server/discover with version, tools capability, resultType and cache hints", async () => {
    const { client, token } = await connect();

    const answer = await result(await modern(client, token, "server/discover"), discovered);

    expect(answer.supportedVersions).toContain(MODERN);
    expect(answer.capabilities.tools).toBeDefined();

    expect(answer.capabilities.resources).toBeUndefined();
    expect(answer.resultType).toBe("complete");
    expect(answer.ttlMs).toBeDefined();
    expect(answer.cacheScope).toBeDefined();
  });

  it("returns tools/list complete, with the workspace's TTL and cacheScope private", async () => {
    const { client, token } = await connect();

    const listed = await result(await modern(client, token, "tools/list"), toolsListed);

    expect(listed.resultType).toBe("complete");
    expect(listed.ttlMs).toBe(TOOLS_LIST_TTL_MS_DEFAULT);
    expect(listed.cacheScope).toBe("private");
  });

  it("reads the TTL from the workspace's config row", async () => {
    const { workspace, client, token } = await connect();
    await app().setWorkspaceConfig(workspace.workspaceId, TOOLS_LIST_TTL_CONFIG_KEY, "42000");

    const listed = await result(await modern(client, token, "tools/list"), toolsListed);

    expect(listed.ttlMs).toBe(42_000);
  });

  it("rejects a header disagreeing with the envelope: 400 and -32020", async () => {
    const { client, token } = await connect();

    const response = await modern(client, token, "tools/list", {}, { version: "2025-11-25" });

    expect(response.status).toBe(400);
    expect((await rpc(response)).error?.code).toBe(-32020);
  });

  it("rejects an envelope missing a required key: 400 and -32602", async () => {
    const { client, token } = await connect();

    const response = await modern(
      client,
      token,
      "tools/list",
      {},
      {
        envelope: { "io.modelcontextprotocol/protocolVersion": MODERN },
      },
    );

    expect(response.status).toBe(400);
    expect((await rpc(response)).error?.code).toBe(-32602);
  });

  it("rejects a missing Mcp-Method and an Mcp-Name disagreeing with params.name", async () => {
    const { client, token } = await connect();

    const missing = await modern(
      client,
      token,
      "tools/list",
      {},
      { headers: { "mcp-method": "" } },
    );
    expect(missing.status).toBe(400);

    const mismatched = await modern(
      client,
      token,
      "tools/call",
      { name: "find", arguments: { query: "x" } },
      {
        headers: { "mcp-name": "open" },
      },
    );
    expect(mismatched.status).toBe(400);
  });

  it("logs a request the handler rejects, as the mcp module", async () => {
    const { client, token } = await connect();
    const before = app().logs.length;

    await modern(client, token, "tools/list", {}, { headers: { "mcp-method": "" } });

    expect(app().logs.slice(before)).toContainEqual(
      matching.objectContaining({
        level: 40,
        module: "mcp",
        event: "mcp.handler_error",
        msg: "handler error",
      }),
    );
  });

  it("names its supported versions to a request declaring another", async () => {
    const { client, token } = await connect();

    const response = await modern(
      client,
      token,
      "tools/list",
      {},
      {
        version: "2027-01-01",
        envelope: { ...ENVELOPE, "io.modelcontextprotocol/protocolVersion": "2027-01-01" },
      },
    );

    const { error } = await rpc(response);
    expect(error?.code).toBe(-32022);
    expect(unsupportedVersion.parse(error?.data).supported).toContain(MODERN);
  });
});

describe("the 2025-11-25 leg", () => {
  it("answers the pre-flight's bare initialize and negotiates 2025-11-25", async () => {
    const { client, token } = await connect();

    const response = await legacy(client, token, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "Anthropic", version: "1.0.0" },
    });

    expect(response.status).toBe(200);
    const answer = await result(response, initialised);
    expect(answer.protocolVersion).toBe("2025-11-25");
    expect(answer.capabilities.tools).toBeDefined();
  });

  it("lists the same four entries without envelope or method headers", async () => {
    const { client, token } = await connect();

    const listed = await result(await legacy(client, token, "tools/list"), toolsListed);

    expect(listed.tools.map((entry) => entry.name)).toEqual([
      "find",
      "ask",
      "open",
      "give_feedback",
    ]);
  });

  it("answers server/discover with method-not-found, so an assistant falls back", async () => {
    const { client, token } = await connect();

    const body = await rpc(await legacy(client, token, "server/discover"));

    expect(body.error?.code).toBe(-32601);
  });
});
