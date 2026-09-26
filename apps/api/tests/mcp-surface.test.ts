import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ANSWER_VERDICTS,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  TRUST_RIDERS,
  TRUST_STATUSES,
  TRUST_TIERS,
} from "@better-answers/core/answering";
import {
  TOOLS_LIST_TTL_CONFIG_KEY,
  TOOLS_LIST_TTL_MS_DEFAULT,
} from "@better-answers/core/workspaces";

import { MCP_TOKEN_RULE } from "../src/auth/constants.ts";
import { connectAsHost } from "./flow.ts";
import { startApp, type TestApp, type TestClient } from "./harness.ts";
import { callMcp } from "./mcp-call.ts";

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

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
  /** Loose, because one case reads the whole schema as text for a header it must not carry. */
  inputSchema: z.looseObject({ properties: z.record(z.string(), z.unknown()).optional() }),
  outputSchema: z.looseObject({}).optional(),
});
type Tool = z.infer<typeof tool>;

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

/** An override of "" leaves the header off the request. */
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
  const workspace = await app.provision();
  const client = app.client();
  const tokens = await connectAsHost(app, client, workspace.admin, { scope });
  return { workspace, client, token: tokens.accessToken };
};

describe("era-independent", () => {
  it("lists a full token's four entries, in a stable order", async () => {
    const { client, token } = await connect();

    const lists = await Promise.all([1, 2, 3].map(() => listTools(client, token)));

    expect(lists[0]?.map((tool) => tool.name)).toEqual(["find", "ask", "open", "give_feedback"]);
    expect(lists[1]).toEqual(lists[0]);
    expect(lists[2]).toEqual(lists[0]);
  });

  it("hides give_feedback from a read-only token and refuses its call", async () => {
    const { client, token } = await connect("knowledge:read offline_access");

    const names = (await listTools(client, token)).map((tool) => tool.name);
    expect(names).toEqual(["find", "ask", "open"]);

    const refused = await rpc(
      await callTool(client, token, "give_feedback", {
        iri: "x",
        verdict: "flag",
        reason: "wrong",
      }),
    );
    expect(refused.error ?? toolCalled.parse(refused.result).isError).toBeTruthy();
  });

  it("annotates every entry: reads read-only, the one write not", async () => {
    const { client, token } = await connect();

    const tools = await listTools(client, token);

    for (const tool of tools) expect(tool.annotations).toBeDefined();
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
      const keys = Object.keys(entry.inputSchema.properties ?? {});
      for (const key of keys) {
        expect(key.toLowerCase()).not.toMatch(/workspace|bundle|tenant/);
      }
      expect(JSON.stringify(entry.inputSchema)).not.toContain("x-mcp-header");
    }
  });

  it.each([
    ["find", "trust tier", TRUST_TIERS],
    ["find", "trust status", TRUST_STATUSES],
    ["find", "trust rider", TRUST_RIDERS],
    ["ask", "verdict", ANSWER_VERDICTS],
    ["open", "trust tier", TRUST_TIERS],
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

  it("describes the two reads in the glossary's words", async () => {
    const { client, token } = await connect();

    const described = new Map(
      (await listTools(client, token)).map((entry) => [entry.name, entry.description ?? ""]),
    );

    expect(described.get("find")).toContain("Not company knowledge");
    expect(described.get("find")).toContain("locator");
    expect(described.get("open")).toContain("locator");
    expect(described.get("open")).toContain(
      "carries the locator that opens it only where the source gives one",
    );
    expect(described.get("open")).toContain("an item with no locator has no passage to open");

    expect(described.get("find")).toContain("hit");
    expect(described.get("find")?.toLowerCase()).not.toContain("chunk");
  });

  it("answers open in structured content and prose, foreign as absent", async () => {
    const { client, token } = await connect();

    const absent = await result(
      await callTool(client, token, "open", { iri: "https://better-answers.com/c/01ABSENT" }),
      toolCalled,
    );
    const foreign = await result(
      await callTool(client, token, "open", { iri: "https://better-answers.com/c/01FOREIGN" }),
      toolCalled,
    );

    expect(absent.structuredContent).toEqual({
      found: false,
      iri: "https://better-answers.com/c/01ABSENT",
    });
    const text = firstText(absent);
    expect(text).toBe("No concept at https://better-answers.com/c/01ABSENT.");
    expect(text).not.toBe(JSON.stringify(absent.structuredContent));
    expect(text.length).toBeLessThan(150_000);
    expect(foreign.structuredContent).toEqual({
      found: false,
      iri: "https://better-answers.com/c/01FOREIGN",
    });
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
        iri: "https://better-answers.com/c/01X",
        verdict: "flag",
        reason: "wrong",
      }),
      toolCalled,
    );
    expect(fed.structuredContent?.["outcome"]).toBe("received");
  });

  it("refuses a revoked person's token, its reason logged, not sent", async () => {
    const { workspace, client, token } = await connect();
    expect((await modern(client, token, "tools/list")).status).toBe(200);

    await app.revokeCredentials(workspace.admin.id, new Date(Date.now() + 1_000));
    const before = app.logs.length;

    const refused = await modern(client, token, "tools/list");
    expect(refused.status).toBe(401);

    const challenge = refused.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).not.toContain("credentials-revoked");
    expect(app.logs.slice(before)).toContainEqual(
      expect.objectContaining({
        event: "mcp.refused",
        refusal: "credentials-revoked",
        class: "unauthenticated",
      }),
    );
  });

  it("refuses a former member's token, its reason logged, not sent", async () => {
    const { workspace, client, token } = await connect();
    await app.removeMember(workspace.workspaceId, workspace.admin.id);
    const before = app.logs.length;

    const refused = await modern(client, token, "tools/list");

    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate") ?? "").not.toContain("not-a-member");
    expect(app.logs.slice(before)).toContainEqual(
      expect.objectContaining({
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

  it("answers 429 with one sentence past the token's ceiling", async () => {
    const { client, token } = await connect();

    let refused: Response | undefined;
    /**
     * The window is wall-clock aligned, so a burst of max + 1 can straddle a boundary and never be
     * refused; 2·max + 1 cannot.
     */
    const enough = 2 * MCP_TOKEN_RULE.max + 1;
    for (let call = 0; call < enough && refused === undefined; call += 1) {
      const answer = await modern(client, token, "tools/list");
      if (answer.status === 429) refused = answer;
    }

    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("retry-after")).not.toBeNull();
    const body = ceilingRefusal.parse(await refused?.json());
    expect(body.error_description).toContain("an Admin can raise the ceiling in System");
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
    await app.setWorkspaceConfig(workspace.workspaceId, TOOLS_LIST_TTL_CONFIG_KEY, "42000");

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

  it("answers server/discover with method-not-found, so a client falls back", async () => {
    const { client, token } = await connect();

    const body = await rpc(await legacy(client, token, "server/discover"));

    expect(body.error?.code).toBe(-32601);
  });
});
