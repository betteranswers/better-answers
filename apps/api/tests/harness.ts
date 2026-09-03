import { Writable } from "node:stream";

import type { Hono } from "hono";
import type { Pool } from "pg";
import { pino } from "pino";

import type { PlatformPrincipal } from "@better-answers/core/kernel";
import { openPostgres } from "@better-answers/core/store/postgres";
import {
  provisionWorkspace,
  revokeCredentials as revokeCredentials_,
} from "@better-answers/core/workspaces";
import { testData, ulid } from "@better-answers/schema/testing";

import type { EmailMessage } from "../src/auth/index.ts";
import { CLIENT_IP_HEADER } from "../src/auth/index.ts";
import { hostnameOfUrl, type PublicHostnames } from "../src/ingress/hostnames.ts";
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

/** The one origin (ADR 0034): the product, the authorization server and the MCP surface. */
export const PUBLIC_URL = "https://app.example.test";
export const MCP_URL = `${PUBLIC_URL}/mcp`;
export const AUTH_SECRET = "test-secret-that-is-at-least-thirty-two-characters-long";

/**
 * The estate's three hostnames as a test's deploy unit sets them (ADR 0022, ADR 0034).
 * The deploy unit sets two; `app.` is `PUBLIC_URL`'s host, read the way `config.ts`
 * derives it and the way the fence reads an arriving `Host` (T-039, T-045). A client
 * speaks to `app.` unless a test names another, so every suite reaches the one surface a
 * browser or a host reaches.
 */
export const APP_HOSTNAME = hostnameOfUrl(PUBLIC_URL);
export const AGENT_HOSTNAME = "agent.example.test";
export const APEX_HOSTNAME = "example.test";
export const HOSTNAMES: PublicHostnames = {
  app: APP_HOSTNAME,
  agent: AGENT_HOSTNAME,
  apex: APEX_HOSTNAME,
};

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

/**
 * A look-alike: Claude's document, word for word, served from a host the closed client
 * list does not name (ADR 0034). What it proves is that the refusal is the list's and not
 * a missing document's — the harness serves it, and the app must still never ask.
 */
export const LOOKALIKE_CLIENT_ID = "https://claude-ai.example/oauth/mcp-oauth-client-metadata";
export const LOOKALIKE_REDIRECT_URI = "https://claude-ai.example/api/mcp/auth_callback";

export type LogLine = Readonly<Record<string, unknown>>;

export type TestApp = {
  readonly server: Hono;
  readonly database: TestDatabase;
  /** Every email the app tried to send, in order. */
  readonly emails: EmailMessage[];
  /** Every client-ID URL the app asked the CIMD transport for, in order. */
  readonly metadataFetches: string[];
  /** Every structured log line the app wrote, parsed. */
  readonly logs: LogLine[];
  /** The last six-digit code sent to an address. */
  codeSentTo(email: string): string;
  /** A workspace with its first Admin, provisioned through the platform's one act. */
  provision(input?: { name?: string; adminEmail?: string }): Promise<Provisioned>;
  /** A person in the identity set with no membership anywhere. */
  person(email?: string): Promise<Person>;
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
  /** A client on one hostname — `app.` unless a test names another (T-030, T-045). */
  client(ip?: string, hostname?: string): TestClient;
  stop(): Promise<void>;
};

export type Provisioned = {
  readonly workspaceId: string;
  readonly name: string;
  readonly admin: Person;
};

/** A person as the identity set holds them; the name is what the shell shows (T-037). */
export type Person = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
};

/** A host-shaped client: full URLs on one hostname's origin, a cookie jar, one client IP. */
export type TestClient = {
  readonly ip: string;
  /** The origin this client speaks to; the `Host` the server reads is its hostname. */
  readonly origin: string;
  fetch(
    path: string,
    init?: RequestInit & { readonly followRedirects?: boolean },
  ): Promise<Response>;
  /** POST a form the way a browser does: a document navigation from this origin. */
  form(path: string, fields: Readonly<Record<string, string>>): Promise<Response>;
  /** POST JSON the way the SPA does: this origin's `Origin` header, and JSON wanted back. */
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

/** A server over any pool, for the tests that need an app with nothing behind it. */
export const serverFor = (pool: Pool): Hono =>
  createServer({
    database: pool,
    publicUrl: PUBLIC_URL,
    hostnames: HOSTNAMES,
    authSecret: AUTH_SECRET,
    sendEmail: async () => {},
    fetchClientMetadataResource: cimdFixture,
    logger: pino({ level: "silent" }),
  });

/**
 * What a suite may vary about the app it starts. The defaults are the ones every suite
 * written before them expects: the estate's three test hostnames on the one test origin,
 * and no SPA build (the server serves the shell only where a test has one to serve).
 */
export type TestAppOptions = {
  /** The directory `apps/web`'s build was written to, for a test that reads the shell. */
  readonly webRoot?: string | undefined;
  /** The estate's three hostnames, for a test whose client is a real browser. */
  readonly hostnames?: PublicHostnames | undefined;
  /**
   * The one origin, for a caller that serves the product somewhere the test hostnames do
   * not say — the browser suite, on a loopback http port. Its host must be `hostnames.app`,
   * as `config.ts` derives it in the estate.
   */
  readonly publicUrl?: string | undefined;
  /**
   * Called with every captured email as it is sent, for the local loop: it prints the
   * code from here, never from the app's logger, which `[LOG1]` forbids from holding one.
   */
  readonly onEmail?: ((message: EmailMessage) => void) | undefined;
};

export const startApp = async (options: TestAppOptions = {}): Promise<TestApp> => {
  const hostnames = options.hostnames ?? HOSTNAMES;
  const publicUrl = options.publicUrl ?? PUBLIC_URL;
  // The invariant `config.ts` holds by construction — the app hostname *is* the public
  // URL's host — checked here because this harness takes the two separately. A mismatch
  // would otherwise surface as a fence 404 on the first request, far from its cause.
  if (hostnameOfUrl(publicUrl) !== hostnames.app) {
    throw new Error(
      `the harness was started with publicUrl ${publicUrl} but hostnames.app ${hostnames.app}; the estate has one origin and its host is the app hostname (ADR 0034)`,
    );
  }
  const database = await startTestDatabase();
  const emails: EmailMessage[] = [];
  const metadataFetches: string[] = [];
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

  const revokeCredentials: TestApp["revokeCredentials"] = async (userId, at) => {
    // Through the platform's one act, as the People screen will: writes the instant,
    // ends the sessions and revokes the refresh tokens minted before it.
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

  const client: TestApp["client"] = (
    ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`,
    hostname = APP_HOSTNAME,
  ) => {
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
      // A browser sends `Origin` on every request that is not a plain navigation, and
      // Better Auth's CSRF fence reads it. A test that omitted it would be a caller no
      // browser can be, and the fence would be proved against the wrong request.
      if (init.method !== undefined && init.method !== "GET" && !headers.has("origin")) {
        headers.set("origin", origin);
      }
      if (jar.size > 0) headers.set("cookie", cookies());
      // A relative path becomes a URL on this client's own hostname, which is the
      // `Host` the hostname fence reads (T-030).
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
          // What a browser sends when a person submits a form: the origin the form was
          // served on, and the Fetch Metadata of a document navigation — which is what
          // the consent form's navigation-only fence reads (`auth/routes.ts`, ADR 0034).
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
          // The three headers the SPA's client sends: what it is posting, where it is
          // posting from — the origin Better Auth's CSRF check reads — and that it wants
          // an answer it can act on rather than a redirect it cannot follow.
          headers: { "content-type": "application/json", origin, accept: "application/json" },
          body: JSON.stringify(body),
        }),
      cookies,
    };
  };

  return {
    server,
    database,
    emails,
    metadataFetches,
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
