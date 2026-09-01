import { Writable } from "node:stream";

import type { Hono } from "hono";
import type { Pool } from "pg";
import { pino } from "pino";

import type { PlatformPrincipal } from "@better-answers/core/kernel";
import { openPostgres } from "@better-answers/core/store/postgres";
import { provisionWorkspace } from "@better-answers/core/workspaces";
import { testData, ulid } from "@better-answers/schema/testing";

import type { EmailMessage } from "../src/auth/index.ts";
import { CLIENT_IP_HEADER } from "../src/auth/index.ts";
import { createServer } from "../src/server.ts";
import { startTestDatabase, type TestDatabase } from "./postgres.ts";

/**
 * The app as a test drives it (`[APP3]`): a real, migrated Postgres, the server built
 * through `createServer` with every outward dependency replaced behind its interface
 * (`[TEST3]`) — the email transport captures codes, the logger captures lines, the
 * CIMD transport serves Claude's real metadata document in process — and a client
 * that speaks to `server.request` the way a host does: full URLs on the public
 * origin, a cookie jar, the tunnel's client-IP header.
 */

export const PUBLIC_URL = "https://mcp.example.test";
export const MCP_URL = `${PUBLIC_URL}/mcp`;
export const AUTH_SECRET = "test-secret-that-is-at-least-thirty-two-characters-long";

/** Claude's CIMD document, fetched from https://claude.ai/oauth/mcp-oauth-client-metadata on 01/09/2026. */
export const CLAUDE_CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
export const CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_METADATA_DOCUMENT = {
  client_id: CLAUDE_CLIENT_ID,
  client_name: "Claude",
  client_uri: "https://claude.ai",
  redirect_uris: [CLAUDE_REDIRECT_URI],
  grant_types: [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  ],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
} as const;

export type LogLine = Readonly<Record<string, unknown>>;

export type TestApp = {
  readonly server: Hono;
  readonly database: TestDatabase;
  /** Every email the app tried to send, in order. */
  readonly emails: EmailMessage[];
  /** Every structured log line the app wrote, parsed. */
  readonly logs: LogLine[];
  /** The last six-digit code sent to an address. */
  codeSentTo(email: string): string;
  /** A workspace with its first Admin, provisioned through the platform's one act. */
  provision(input?: { name?: string; adminEmail?: string }): Promise<Provisioned>;
  /** A person in the identity set with no membership anywhere. */
  person(email?: string): Promise<{ id: string; email: string }>;
  /** Add a person to a workspace at a role (seeded directly: Better Auth's invitation flow is not under test). */
  addMember(
    workspaceId: string,
    userId: string,
    role: "Admin" | "Editor" | "Viewer",
  ): Promise<void>;
  /** The superuser writes the revocation instant the People screen will one day write. */
  revokeCredentials(userId: string, at: Date): Promise<void>;
  /** End a membership, as the People screen will one day. */
  removeMember(workspaceId: string, userId: string): Promise<void>;
  /** Set a workspace's config row, as the System screen will one day. */
  setWorkspaceConfig(workspaceId: string, key: string, value: string): Promise<void>;
  client(ip?: string): TestClient;
  stop(): Promise<void>;
};

export type Provisioned = {
  readonly workspaceId: string;
  readonly name: string;
  readonly admin: { readonly id: string; readonly email: string };
};

/** A host-shaped client: full URLs on the public origin, a cookie jar, one client IP. */
export type TestClient = {
  readonly ip: string;
  fetch(
    path: string,
    init?: RequestInit & { readonly followRedirects?: boolean },
  ): Promise<Response>;
  /** POST a form the way a browser does. */
  form(path: string, fields: Readonly<Record<string, string>>): Promise<Response>;
  cookies(): string;
};

const bootstrap: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

const cimdFixture = async (input: string | URL | Request): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === CLAUDE_CLIENT_ID) {
    return Response.json(CLAUDE_METADATA_DOCUMENT, {
      headers: { "content-type": "application/json", "cache-control": "max-age=3600" },
    });
  }
  return new Response("no such document", { status: 404 });
};

/** A server over any pool, for the tests that need an app with nothing behind it. */
export const serverFor = (pool: Pool): Hono =>
  createServer({
    database: pool,
    publicUrl: PUBLIC_URL,
    authSecret: AUTH_SECRET,
    sendEmail: async () => {},
    fetchClientMetadataResource: cimdFixture,
    logger: pino({ level: "silent" }),
  });

export const startApp = async (): Promise<TestApp> => {
  const database = await startTestDatabase();
  const emails: EmailMessage[] = [];
  const logs: LogLine[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim() === "") continue;
        // SAFETY: pino writes one JSON object per line; a line is an object by construction.
        logs.push(JSON.parse(line) as LogLine);
      }
      callback();
    },
  });
  const logger = pino({ level: "info" }, sink);

  const server = createServer({
    database: database.pool,
    publicUrl: PUBLIC_URL,
    authSecret: AUTH_SECRET,
    sendEmail: async (message) => {
      emails.push(message);
    },
    fetchClientMetadataResource: cimdFixture,
    logger,
  });
  const door = openPostgres(database.pool);

  const person: TestApp["person"] = async (email) => {
    const client = await database.superuser.connect();
    try {
      const created = await testData(client).user(email === undefined ? {} : { email });
      return { id: created.id, email: created.email };
    } finally {
      client.release();
    }
  };

  const provision: TestApp["provision"] = async (input = {}) => {
    const admin = await person(input.adminEmail);
    const id = ulid();
    const name = input.name ?? `Workspace ${id.slice(-4)}`;
    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name,
      slug: `ws-${id.toLowerCase()}`,
      adminUserId: admin.id,
    });
    if (!provisioned.ok) throw new Error(`provisioning failed: ${provisioned.error}`);
    return { workspaceId: id, name, admin };
  };

  const addMember: TestApp["addMember"] = async (workspaceId, userId, role) => {
    const client = await database.superuser.connect();
    try {
      await testData(client).member({ workspaceId, userId, role });
    } finally {
      client.release();
    }
  };

  const revokeCredentials: TestApp["revokeCredentials"] = async (userId, at) => {
    await database.superuser.query('UPDATE "user" SET credentials_revoked_at = $2 WHERE id = $1', [
      userId,
      at,
    ]);
  };

  const removeMember: TestApp["removeMember"] = async (workspaceId, userId) => {
    await database.superuser.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      workspaceId,
      userId,
    ]);
  };

  const setWorkspaceConfig: TestApp["setWorkspaceConfig"] = async (workspaceId, key, value) => {
    await database.superuser.query(
      "UPDATE workspace_config SET value = $3 WHERE workspace_id = $1 AND key = $2",
      [workspaceId, key, value],
    );
  };

  const codeSentTo: TestApp["codeSentTo"] = (email) => {
    const message = emails.findLast((candidate) => candidate.to === email);
    const code = message?.text.match(/\b(\d{6})\b/)?.[1];
    if (code === undefined) throw new Error(`no code was sent to ${email}`);
    return code;
  };

  const client: TestApp["client"] = (ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`) => {
    const jar = new Map<string, string>();
    const remember = (response: Response) => {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const [name, value] = (pair ?? "").split("=");
        if (name === undefined) continue;
        if (value === undefined || value === "") jar.delete(name);
        else jar.set(name, value);
      }
    };
    const cookies = () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set(CLIENT_IP_HEADER, ip);
      if (jar.size > 0) headers.set("cookie", cookies());
      const url = path.startsWith("http") ? path : `${PUBLIC_URL}${path}`;
      const response = await server.request(new Request(url, { ...init, headers }));
      remember(response);
      return response;
    };
    return {
      ip,
      fetch: request,
      form: (path, fields) =>
        request(path, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", origin: PUBLIC_URL },
          body: new URLSearchParams(fields).toString(),
        }),
      cookies,
    };
  };

  return {
    server,
    database,
    emails,
    logs,
    codeSentTo,
    provision,
    person,
    addMember,
    revokeCredentials,
    removeMember,
    setWorkspaceConfig,
    client,
    stop: () => database.stop(),
  };
};
