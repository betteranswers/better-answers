import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TOOLS_LIST_TTL_CONFIG_KEY,
  TOOLS_LIST_TTL_MS_DEFAULT,
} from "@better-answers/core/workspaces";

import { connectAsHost } from "./flow.ts";
import { startApp, type TestApp, type TestClient } from "./harness.ts";

/**
 * The MCP half of research 80 §9's host-agnostic conformance test (assertions 1–18),
 * run against the real handler with a token the real flow minted, on both protocol
 * eras: the 2026-07-28 envelope claude.ai's authenticated runtime sends and the bare
 * 2025-11-25 `initialize` its unauthenticated pre-flight sends. Plus T-004's own
 * lines: annotations on every entry, no workspace argument, structured `open`, the
 * per-call revocation check, and the per-token counter's 429.
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app.stop();
});

type Rpc = Readonly<Record<string, unknown>>;

const MODERN = "2026-07-28";
const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "Anthropic/ClaudeAI", version: "1.0.0" },
};

/** A 2026-era call: the `_meta` envelope in the body, the version and method mirrored into headers. */
const modern = async (
  client: TestClient,
  token: string,
  method: string,
  params: Rpc = {},
  overrides: { headers?: Record<string, string>; envelope?: Rpc | null; version?: string } = {},
): Promise<Response> => {
  const envelope = overrides.envelope === undefined ? ENVELOPE : overrides.envelope;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "mcp-protocol-version": overrides.version ?? MODERN,
    "mcp-method": method,
    ...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
    ...overrides.headers,
  };
  for (const [name, value] of Object.entries(headers)) if (value === "") delete headers[name];
  return client.fetch("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e9),
      method,
      params: envelope === null ? params : { ...params, _meta: envelope },
    }),
  });
};

/** A 2025-era call: no envelope, no method headers — what the pre-flight and the legacy runtime send. */
const legacy = async (
  client: TestClient,
  token: string,
  method: string,
  params: Rpc = {},
): Promise<Response> =>
  client.fetch("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

const rpc = async (response: Response): Promise<Rpc> => {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    // A streamed answer: the last `data:` frame is the result.
    const frames = (await response.text()).split("\n").filter((line) => line.startsWith("data:"));
    return JSON.parse(frames.at(-1)?.slice("data:".length) ?? "{}") as Rpc;
  }
  return (await response.json()) as Rpc;
};

const result = async (response: Response): Promise<Rpc> => {
  const body = await rpc(response);
  expect(body["error"]).toBeUndefined();
  return (body["result"] ?? {}) as Rpc;
};

type Tool = { name: string; annotations?: Rpc; inputSchema: { properties?: Rpc } & Rpc };

const listTools = async (client: TestClient, token: string): Promise<Tool[]> =>
  ((await result(await modern(client, token, "tools/list")))["tools"] ?? []) as Tool[];

const callTool = (client: TestClient, token: string, name: string, args: Rpc) =>
  modern(client, token, "tools/call", { name, arguments: args });

const connect = async (scope = "knowledge:read feedback:write offline_access") => {
  const workspace = await app.provision();
  const client = app.client();
  const tokens = await connectAsHost(app, client, workspace.admin, { scope });
  return { workspace, client, token: tokens.accessToken };
};

describe("era-independent", () => {
  it("lists exactly the four entries a full token reaches, in the same order every time (§9 1)", async () => {
    const { client, token } = await connect();

    const lists = await Promise.all([1, 2, 3].map(() => listTools(client, token)));

    expect(lists[0]?.map((tool) => tool.name)).toEqual(["find", "ask", "open", "give_feedback"]);
    expect(lists[1]).toEqual(lists[0]);
    expect(lists[2]).toEqual(lists[0]);
  });

  it("omits give_feedback for a read-only token and refuses the call anyway (§9 2)", async () => {
    const { client, token } = await connect("knowledge:read offline_access");

    const names = (await listTools(client, token)).map((tool) => tool.name);
    expect(names).toEqual(["find", "ask", "open"]);

    const refused = await rpc(
      await callTool(client, token, "give_feedback", { iri: "x", reason: "wrong" }),
    );
    expect(refused["error"] ?? (refused["result"] as Rpc)["isError"]).toBeTruthy();
  });

  it("carries annotations on every entry: reads read-only, the one write not (ADR 0018)", async () => {
    const { client, token } = await connect();

    const tools = await listTools(client, token);

    for (const tool of tools) expect(tool.annotations).toBeDefined();
    expect(tools.map((tool) => [tool.name, tool.annotations?.["readOnlyHint"]])).toEqual([
      ["find", true],
      ["ask", true],
      ["open", true],
      ["give_feedback", false],
    ]);
  });

  it("takes no workspace, bundle or tenant argument on any entry, and mirrors nothing into headers (§9 3, 14)", async () => {
    const { client, token } = await connect();

    for (const tool of await listTools(client, token)) {
      const keys = Object.keys(tool.inputSchema.properties ?? {});
      for (const key of keys) {
        expect(key.toLowerCase()).not.toMatch(/workspace|bundle|tenant/);
      }
      expect(JSON.stringify(tool.inputSchema)).not.toContain("x-mcp-header");
    }
  });

  it("answers open with structured content and a human rendering that is not the JSON, alike for absent and foreign IRIs (§9 4, 7)", async () => {
    const { client, token } = await connect();

    const absent = await result(
      await callTool(client, token, "open", { iri: "https://better-answers.com/c/01ABSENT" }),
    );
    const foreign = await result(
      await callTool(client, token, "open", { iri: "https://better-answers.com/c/01FOREIGN" }),
    );

    expect(absent["structuredContent"]).toEqual({
      found: false,
      iri: "https://better-answers.com/c/01ABSENT",
    });
    const text = String(((absent["content"] as Rpc[])[0] ?? {})["text"]);
    expect(text).toBe("No concept at https://better-answers.com/c/01ABSENT.");
    expect(text).not.toBe(JSON.stringify(absent["structuredContent"]));
    expect(text.length).toBeLessThan(150_000);
    expect(foreign["structuredContent"]).toEqual({
      found: false,
      iri: "https://better-answers.com/c/01FOREIGN",
    });
  });

  it("answers find, ask and give_feedback through the Principal", async () => {
    const { client, token } = await connect();

    const found = await result(await callTool(client, token, "find", { query: "accreditation" }));
    expect(found["structuredContent"]).toEqual({ query: "accreditation", hits: [] });

    const asked = await result(
      await callTool(client, token, "ask", { question: "What accreditations do we hold?" }),
    );
    expect((asked["structuredContent"] as Rpc)["verdict"]).toBe("refuse");
    expect(String(((asked["content"] as Rpc[])[0] ?? {})["text"])).toMatch(/^\*\*Not answered/);

    const fed = await result(
      await callTool(client, token, "give_feedback", {
        iri: "https://better-answers.com/c/01X",
        reason: "wrong",
      }),
    );
    expect((fed["structuredContent"] as Rpc)["outcome"]).toBe("received");
  });

  it("refuses a token whose person was revoked after it was issued, on the next call (§9 6; ADR 0018)", async () => {
    const { workspace, client, token } = await connect();
    expect((await modern(client, token, "tools/list")).status).toBe(200);

    await app.revokeCredentials(workspace.admin.id, new Date(Date.now() + 1_000));

    const refused = await modern(client, token, "tools/list");
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain("credentials-revoked");
  });

  it("refuses a token whose person is no longer a member", async () => {
    const { workspace, client, token } = await connect();
    await app.removeMember(workspace.workspaceId, workspace.admin.id);

    const refused = await modern(client, token, "tools/list");

    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain("not-a-member");
  });

  it("refuses a bearer that is not this issuer's (§9 5)", async () => {
    const { client } = await connect();

    const refused = await modern(
      client,
      "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.bm90LWEtc2lnbmF0dXJl",
      "tools/list",
    );

    expect(refused.status).toBe(401);
  });

  it("counts every call against the token and answers 429 with one sentence past the ceiling (ADR 0018)", async () => {
    const { client, token } = await connect();
    let last: Response | undefined;
    for (let call = 0; call < 121; call += 1) last = await modern(client, token, "tools/list");

    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).not.toBeNull();
    const body = (await last?.json()) as Rpc;
    expect(String(body["error_description"])).toContain("an Admin can raise the ceiling in System");
  });
});

describe("the 2026-07-28 leg", () => {
  it("answers server/discover with the version, the tools capability, resultType and cache hints (§9 8)", async () => {
    const { client, token } = await connect();

    const discovered = await result(await modern(client, token, "server/discover"));

    expect(discovered["supportedVersions"]).toContain(MODERN);
    expect((discovered["capabilities"] as Rpc)["tools"]).toBeDefined();
    // Tools only (ADR 0008; ADR 0030's clarification): no concept is a resource in v0.1.
    expect((discovered["capabilities"] as Rpc)["resources"]).toBeUndefined();
    expect(discovered["resultType"]).toBe("complete");
    expect(discovered["ttlMs"]).toBeDefined();
    expect(discovered["cacheScope"]).toBeDefined();
  });

  it("returns tools/list complete, with the workspace's TTL and cacheScope private (§9 9; F5)", async () => {
    const { client, token } = await connect();

    const listed = await result(await modern(client, token, "tools/list"));

    expect(listed["resultType"]).toBe("complete");
    expect(listed["ttlMs"]).toBe(TOOLS_LIST_TTL_MS_DEFAULT);
    expect(listed["cacheScope"]).toBe("private");
  });

  it("reads the TTL from the workspace's config row", async () => {
    const { workspace, client, token } = await connect();
    await app.setWorkspaceConfig(workspace.workspaceId, TOOLS_LIST_TTL_CONFIG_KEY, "42000");

    const listed = await result(await modern(client, token, "tools/list"));

    expect(listed["ttlMs"]).toBe(42_000);
  });

  it("rejects a header that disagrees with the envelope with 400 and -32020 (§9 10)", async () => {
    const { client, token } = await connect();

    const response = await modern(client, token, "tools/list", {}, { version: "2025-11-25" });

    expect(response.status).toBe(400);
    expect(((await rpc(response))["error"] as Rpc)["code"]).toBe(-32020);
  });

  it("rejects an envelope missing a required key with 400 and -32602 (§9 11)", async () => {
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
    expect(((await rpc(response))["error"] as Rpc)["code"]).toBe(-32602);
  });

  it("rejects a call missing Mcp-Method, and one whose Mcp-Name disagrees with params.name (§9 12)", async () => {
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

  it("names its supported versions when a request declares one it does not speak (§9 13)", async () => {
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

    const error = (await rpc(response))["error"] as Rpc;
    expect(error["code"]).toBe(-32022);
    expect((error["data"] as Rpc)["supported"] as string[]).toContain(MODERN);
  });
});

describe("the 2025-11-25 leg", () => {
  it("answers the pre-flight's bare initialize and negotiates 2025-11-25 (§9 16)", async () => {
    const { client, token } = await connect();

    const response = await legacy(client, token, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "Anthropic", version: "1.0.0" },
    });

    expect(response.status).toBe(200);
    const initialised = await result(response);
    expect(initialised["protocolVersion"]).toBe("2025-11-25");
    expect((initialised["capabilities"] as Rpc)["tools"]).toBeDefined();
  });

  it("lists the same four entries with no envelope and no method headers (§9 17)", async () => {
    const { client, token } = await connect();

    const listed = await result(await legacy(client, token, "tools/list"));

    expect((listed["tools"] as Tool[]).map((tool) => tool.name)).toEqual([
      "find",
      "ask",
      "open",
      "give_feedback",
    ]);
  });

  it("answers server/discover on this leg with method-not-found, so a client falls back (§9 18)", async () => {
    const { client, token } = await connect();

    const body = await rpc(await legacy(client, token, "server/discover"));

    expect((body["error"] as Rpc)["code"]).toBe(-32601);
  });
});
