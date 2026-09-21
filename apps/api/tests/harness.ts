import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import type { Hono } from "hono";
import type { Pool } from "pg";
import { pino } from "pino";

import { systemClock, type Clock, type PlatformPrincipal } from "@better-answers/core/kernel";
import { openGit, type GitDoor } from "@better-answers/core/store/git";
import { openPostgres } from "@better-answers/core/store/postgres";
import { removeBundleRoot } from "@better-answers/core/testing/bundle-root";
import {
  provisionWorkspace,
  revokeCredentials as revokeCredentials_,
} from "@better-answers/core/workspaces";
import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { EmailMessage } from "../src/auth/index.ts";
import { CLIENT_IP_HEADER } from "../src/auth/index.ts";
import { hostnameOfUrl, type PublicHostnames } from "../src/ingress/hostnames.ts";
import { createServer } from "../src/server.ts";
import { defaultClientAddresses } from "./client-addresses.ts";
import { startTestDatabase, type TestDatabase } from "./postgres.ts";

export const PUBLIC_URL = "https://app.example.test";
export const MCP_URL = `${PUBLIC_URL}/mcp`;
export const AUTH_SECRET = "test-secret-that-is-at-least-thirty-two-characters-long";

export const APP_HOSTNAME = hostnameOfUrl(PUBLIC_URL);
export const AGENT_HOSTNAME = "agent.example.test";
export const APEX_HOSTNAME = "example.test";
const HOSTNAMES: PublicHostnames = {
  app: APP_HOSTNAME,
  agent: AGENT_HOSTNAME,
  apex: APEX_HOSTNAME,
};

export const CLAUDE_CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
export const CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_METADATA_DOCUMENT = {
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

export const LOOKALIKE_CLIENT_ID = "https://claude-ai.example/oauth/mcp-oauth-client-metadata";
const LOOKALIKE_REDIRECT_URI = "https://claude-ai.example/api/mcp/auth_callback";

export type LogLine = Readonly<Record<string, unknown>>;

export const capturingLogger = (level: "debug" | "info" = "info") => {
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
  return { logger: pino({ level }, sink), logs };
};

export type TestApp = {
  readonly server: Hono;
  readonly database: TestDatabase;

  readonly gitStoreDir: string;

  readonly emails: EmailMessage[];

  readonly metadataFetches: string[];

  readonly logs: LogLine[];

  codeSentTo(email: string): string;

  provision(input?: {
    name?: string | undefined;
    adminEmail?: string | undefined;
  }): Promise<Provisioned>;

  person(email?: string): Promise<Person>;

  addMember(
    workspaceId: string,
    userId: string,
    role: "Admin" | "Editor" | "Viewer",
  ): Promise<void>;

  invite(input: { workspaceId: string; email: string; inviterId: string }): Promise<{ id: string }>;

  setEmailVerified(email: string, verified: boolean): Promise<void>;

  revokeCredentials(userId: string, at: Date): Promise<void>;

  removeMember(workspaceId: string, userId: string): Promise<void>;

  setWorkspaceConfig(workspaceId: string, key: string, value: string): Promise<void>;

  client(ip?: string, hostname?: string): TestClient;
  stop(): Promise<void>;
};

type Provisioned = {
  readonly workspaceId: string;
  readonly name: string;
  readonly admin: Person;
};

type Person = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
};

export type TestClient = {
  readonly ip: string;

  readonly origin: string;
  fetch(
    path: string,
    init?: RequestInit & { readonly followRedirects?: boolean },
  ): Promise<Response>;

  form(path: string, fields: Readonly<Record<string, string>>): Promise<Response>;

  json(path: string, body: unknown): Promise<Response>;
  cookies(): string;
};

const bootstrap: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

const cimdFixture = async (input: string | URL | Request): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const document = (clientId: string, redirectUri: string) =>
    Response.json(
      { ...CLAUDE_METADATA_DOCUMENT, client_id: clientId, redirect_uris: [redirectUri] },
      { headers: { "content-type": "application/json", "cache-control": "max-age=3600" } },
    );
  if (url.href === CLAUDE_CLIENT_ID) return document(CLAUDE_CLIENT_ID, CLAUDE_REDIRECT_URI);
  if (url.href === LOOKALIKE_CLIENT_ID) {
    return document(LOOKALIKE_CLIENT_ID, LOOKALIKE_REDIRECT_URI);
  }
  return new Response("no such document", { status: 404 });
};

export const serverFor = (pool: Pool): Hono =>
  createServer({
    database: pool,
    publicUrl: PUBLIC_URL,
    hostnames: HOSTNAMES,
    authSecret: AUTH_SECRET,
    sendEmail: async () => {},
    fetchClientMetadataResource: cimdFixture,
    logger: pino({ level: "silent" }),
    clock: systemClock(),
  });

export const openTestGit = (app: TestApp): GitDoor => {
  const opened = openGit(app.gitStoreDir);
  if (!opened.ok) throw new Error(`the test app's git store was refused: ${opened.error}`);
  return opened.value;
};

export type TestAppOptions = {
  readonly webRoot?: string | undefined;

  readonly hostnames?: PublicHostnames | undefined;

  readonly publicUrl?: string | undefined;

  readonly onEmail?: ((message: EmailMessage) => void) | undefined;

  readonly clock?: Clock | undefined;
};

export const startApp = async (options: TestAppOptions = {}): Promise<TestApp> => {
  const hostnames = options.hostnames ?? HOSTNAMES;
  const publicUrl = options.publicUrl ?? PUBLIC_URL;

  if (hostnameOfUrl(publicUrl) !== hostnames.app) {
    throw new Error(
      `the harness was started with publicUrl ${publicUrl} but hostnames.app ${hostnames.app}; the estate has one origin and its host is the app hostname (ADR 0034)`,
    );
  }
  const database = await startTestDatabase();

  const gitStoreDir = await mkdtemp(path.join(tmpdir(), "better-answers-git-"));
  const emails: EmailMessage[] = [];
  const metadataFetches: string[] = [];
  const { logger, logs } = capturingLogger();

  const server = createServer({
    database: database.pool,
    publicUrl,
    hostnames,
    authSecret: AUTH_SECRET,
    sendEmail: async (message) => {
      emails.push(message);
      options.onEmail?.(message);
    },
    fetchClientMetadataResource: (input) => {
      metadataFetches.push(input instanceof Request ? input.url : String(input));
      return cimdFixture(input);
    },
    logger,
    webRoot: options.webRoot,
    clock: options.clock ?? systemClock(),
  });
  const door = openPostgres(database.pool);

  const person: TestApp["person"] = async (email) => {
    const client = await database.superuser.connect();
    try {
      const created = await testData(client).user(email === undefined ? {} : { email });
      return { id: created.id, email: created.email, name: created.name };
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

  const invite: TestApp["invite"] = async (input) => {
    const client = await database.superuser.connect();
    try {
      const created = await testData(client).invitation({
        workspaceId: input.workspaceId,
        email: input.email,
        inviterId: input.inviterId,
      });
      return { id: created.id };
    } finally {
      client.release();
    }
  };

  const setEmailVerified: TestApp["setEmailVerified"] = async (email, verified) => {
    await database.superuser.query('UPDATE "user" SET email_verified = $2 WHERE email = $1', [
      email,
      verified,
    ]);
  };

  const revokeCredentials: TestApp["revokeCredentials"] = async (userId, at) => {
    const revoked = await revokeCredentials_(
      { kind: "platform", actorId: "process:better-answers-test" },
      door,
      { userId, at },
    );
    if (!revoked.ok) throw new Error(`revokeCredentials failed: ${String(revoked.error)}`);
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

  const nextDefaultAddress = defaultClientAddresses();

  const client: TestApp["client"] = (ip = nextDefaultAddress(), hostname = APP_HOSTNAME) => {
    const origin = `https://${hostname}`;
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

      if (init.method !== undefined && init.method !== "GET" && !headers.has("origin")) {
        headers.set("origin", origin);
      }
      if (jar.size > 0) headers.set("cookie", cookies());

      const url = path.startsWith("http") ? path : `${origin}${path}`;
      const response = await server.request(new Request(url, { ...init, headers }));
      remember(response);
      return response;
    };
    return {
      ip,
      origin,
      fetch: request,
      form: (path, fields) =>
        request(path, {
          method: "POST",

          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin,
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "same-origin",
          },
          body: new URLSearchParams(fields).toString(),
        }),
      json: (path, body) =>
        request(path, {
          method: "POST",

          headers: { "content-type": "application/json", origin, accept: "application/json" },
          body: JSON.stringify(body),
        }),
      cookies,
    };
  };

  return {
    server,
    database,
    gitStoreDir,
    emails,
    metadataFetches,
    logs,
    codeSentTo,
    provision,
    person,
    addMember,
    invite,
    setEmailVerified,
    revokeCredentials,
    removeMember,
    setWorkspaceConfig,
    client,
    stop: async () => {
      await database.stop();

      await removeBundleRoot(gitStoreDir);
    },
  };
};
