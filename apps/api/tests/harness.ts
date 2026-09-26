import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import type { Hono } from "hono";
import { Pool } from "pg";
import { pino } from "pino";
import { z } from "zod";

import type { Clock, PlatformPrincipal, UserPrincipal } from "@better-answers/core/kernel";
import type { GitDoor } from "@better-answers/core/store/git";
import type { ObjectStoreSettings } from "@better-answers/core/store/objects";
import {
  folded,
  withOperator,
  withPrincipal,
  type Foldable,
  type Tx,
} from "@better-answers/core/store/postgres";
import { removeBundleRoot } from "@better-answers/core/testing/bundle-root";
import {
  provisionWorkspace,
  revokeCredentials as revokeCredentials_,
  setOperatorMark,
} from "@better-answers/core/workspaces";
import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { EmailMessage } from "../src/auth/index.ts";
import { CLIENT_IP_HEADER } from "../src/auth/index.ts";
import { openDoors, type Doors } from "../src/doors.ts";
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

/** On a host that only resembles Claude's; the metadata fixture serves it a document too. */
export const LOOKALIKE_CLIENT_ID = "https://claude-ai.example/oauth/mcp-oauth-client-metadata";
const LOOKALIKE_REDIRECT_URI = "https://claude-ai.example/api/mcp/auth_callback";

/** pino writes one JSON object per line: its own level and time, then whatever the call logged. */
const logLine = z.looseObject({ level: z.number(), time: z.number() });
export type LogLine = Readonly<z.infer<typeof logLine>>;

export const capturingLogger = (level: "debug" | "info" = "info") => {
  const logs: LogLine[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim() === "") continue;
        logs.push(logLine.parse(JSON.parse(line)));
      }
      callback();
    },
  });
  return { logger: pino({ level }, sink), logs };
};

export type TestApp = {
  readonly server: Hono;
  readonly database: TestDatabase;

  readonly doors: Doors;

  readonly gitStoreDir: string;

  readonly emails: EmailMessage[];

  /** Each URL the api asked for a client's metadata document, in order. */
  readonly metadataFetches: string[];

  readonly logs: LogLine[];

  /**
   * The six-digit code in the latest email to `email`.
   * @throws when none went to it, or the latest holds no code.
   */
  codeSentTo(email: string): string;

  /** A new workspace, and a new person as its Admin. */
  provision(input?: {
    name?: string | undefined;
    adminEmail?: string | undefined;
  }): Promise<Provisioned>;

  person(email?: string, name?: string): Promise<Person>;

  addMember(
    workspaceId: string,
    userId: string,
    role: "Admin" | "Editor" | "Viewer",
  ): Promise<{ id: string }>;

  /** A waiting invitation, written as a row; the factory's own role when none is named. */
  invite(input: {
    workspaceId: string;
    email: string;
    inviterId: string;
    role?: "Admin" | "Editor" | "Viewer" | undefined;
  }): Promise<{ id: string }>;

  setEmailVerified(email: string, verified: boolean): Promise<void>;

  revokeCredentials(userId: string, at: Date): Promise<void>;

  /**
   * Grants or clears the operator mark of the person holding `email`, as the ops command does.
   * @throws when no person holds it.
   */
  markOperator(email: string, change: "grant" | "revoke"): Promise<void>;

  removeMember(workspaceId: string, userId: string): Promise<void>;

  /** Updates a key the workspace already holds; a key it lacks stays absent, silently. */
  setWorkspaceConfig(workspaceId: string, key: string, value: string): Promise<void>;

  /** A TestClient with its own cookie jar; without `ip` it takes the next default address. */
  client(ip?: string, hostname?: string): TestClient;
  stop(): Promise<void>;
};

type Provisioned = {
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
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
  /** A path resolves on `origin`; cookies go from and to the jar, and a non-GET gains `origin`. */
  fetch(
    path: string,
    init?: RequestInit & { readonly followRedirects?: boolean },
  ): Promise<Response>;

  /** Posts `fields` as a browser's same-origin form navigation does. */
  form(path: string, fields: Readonly<Record<string, string>>): Promise<Response>;

  json(path: string, body: unknown): Promise<Response>;
  /** The jar as a `cookie` header's value. */
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

type DoorOptions = {
  readonly gitStoreDir?: string | undefined;
  readonly objectStore?: ObjectStoreSettings | undefined;
  readonly clock?: Clock | undefined;
};

export const doorsFor = (database: Pool | string, options: DoorOptions = {}): Doors =>
  openDoors({ database, ...options });

/** A server over `pool` with no TestApp around it: emails go nowhere and nothing is logged. */
export const serverFor = (
  pool: Pool,
  options: { readonly imageDigest?: string | undefined } = {},
): Hono =>
  createServer({
    doors: doorsFor(pool),
    publicUrl: PUBLIC_URL,
    hostnames: HOSTNAMES,
    authSecret: AUTH_SECRET,
    sendEmail: async () => {},
    fetchClientMetadataResource: cimdFixture,
    logger: pino({ level: "silent" }),
    imageDigest: options.imageDigest,
  });

/**
 * Runs `work` in one transaction as the member `who` names.
 * @throws when the membership or `work` answers a refusal.
 */
export const actingIn = async <T>(
  app: TestApp,
  who: { readonly workspaceId: string; readonly userId: string },
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
) => {
  const answered = folded<T>(
    await withPrincipal(app.doors.postgres, { ...who, issuedAt: new Date() }, work),
  );
  if (!answered.ok) throw new Error(`the act answered ${String(answered.error)}`);
  return answered.value;
};

/** @throws when the TestApp's repositories' root did not open. */
export const openTestGit = (app: TestApp): GitDoor => {
  if (app.doors.git?.ok !== true) {
    throw new Error(`the TestApp's repositories' root is ${app.doors.git?.error ?? "not set"}`);
  }
  return app.doors.git.value;
};

export type TestAppOptions = {
  readonly webRoot?: string | undefined;

  readonly hostnames?: PublicHostnames | undefined;

  readonly publicUrl?: string | undefined;

  readonly onEmail?: ((message: EmailMessage) => void) | undefined;

  readonly clock?: Clock | undefined;

  readonly objectStore?: ObjectStoreSettings | undefined;

  /**
   * A count of connections below the pool's ceiling reads what was asked for, and the suite's
   * runtime pool is small.
   */
  readonly poolSize?: number | undefined;
};

/**
 * A TestApp over a fresh migrated database and git root; `stop` removes both.
 * @throws when `publicUrl`'s host is not `hostnames.app`.
 */
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

  const pool =
    options.poolSize === undefined
      ? database.pool
      : new Pool({ ...database.pool.options, max: options.poolSize });
  const doors = doorsFor(pool, {
    gitStoreDir,
    clock: options.clock,
    objectStore: options.objectStore,
  });
  const server = createServer({
    doors,
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
  const door = doors.postgres;

  const person: TestApp["person"] = async (email, name) => {
    const named = name === undefined ? {} : { name };
    const client = await database.superuser.connect();
    try {
      const created = await testData(client).user(
        email === undefined ? named : { ...named, email },
      );
      return { id: created.id, email: created.email, name: created.name };
    } finally {
      client.release();
    }
  };

  const provision: TestApp["provision"] = async (input = {}) => {
    const admin = await person(input.adminEmail);
    const id = ulid();
    const name = input.name ?? `Workspace ${id.slice(-4)}`;
    const slug = `ws-${id.toLowerCase()}`;
    const provisioned = await provisionWorkspace(bootstrap, door, {
      id,
      name,
      slug,
      adminUserId: admin.id,
    });
    if (!provisioned.ok) throw new Error(`provisioning failed: ${provisioned.error}`);
    return { workspaceId: id, name, slug, admin };
  };

  const addMember: TestApp["addMember"] = async (workspaceId, userId, role) => {
    const client = await database.superuser.connect();
    try {
      const created = await testData(client).member({ workspaceId, userId, role });
      return { id: created.id };
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
        ...(input.role === undefined ? {} : { role: input.role }),
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

  /** Made on the first revocation, so a suite that never revokes holds no extra person. */
  let operatorMade: Promise<string> | undefined;
  const operatorsId = (): Promise<string> => {
    operatorMade ??= (async () => {
      const client = await database.superuser.connect();
      try {
        return (await testData(client).user({ operator: true })).id;
      } finally {
        client.release();
      }
    })();
    return operatorMade;
  };

  const revokeCredentials: TestApp["revokeCredentials"] = async (userId, at) => {
    const opened = await withOperator(
      door,
      { userId: await operatorsId(), issuedAt: at },
      (operator, tx) => revokeCredentials_(operator, tx, { personId: userId, at }),
    );
    const revoked = opened.ok ? opened.value : opened;
    if (!revoked.ok) throw new Error(`revokeCredentials failed: ${String(revoked.error)}`);
  };

  const markOperator: TestApp["markOperator"] = async (email, change) => {
    const marked = await setOperatorMark(bootstrap, door, { email, change });
    if (!marked.ok) throw new Error(`the mark was refused: ${String(marked.error)}`);
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
    doors,
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
    markOperator,
    removeMember,
    setWorkspaceConfig,
    client,
    stop: async () => {
      if (pool !== database.pool) await pool.end();
      await database.stop();

      await removeBundleRoot(gitStoreDir);
    },
  };
};
