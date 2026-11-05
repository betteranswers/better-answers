import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AUTHORIZE_PATH,
  PENDING_LIBRARY_PATHS,
  PENDING_PROCEDURES,
  SESSIONLESS_LIBRARY_PATHS,
} from "../src/second-factor-gate.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { appRouter } from "../src/trpc/router.ts";
import { authAsBuiltForSuite } from "./support/auth-instance.ts";
import { holdAnAuthenticator } from "./support/factor-harness.ts";
import type { TestClient } from "./support/harness/harness.ts";
import { signedInByEmailOnly } from "./support/provoke.ts";
import { appForSuite } from "./support/suite-app.ts";

const app = appForSuite();

const asBuilt = authAsBuiltForSuite();

const aPendingSession = async (): Promise<TestClient> => {
  const workspace = await app().provision();
  await holdAnAuthenticator(app(), workspace.admin.id);
  return signedInByEmailOnly(app(), workspace.admin.email);
};

let sharedSession: TestClient;

beforeAll(async () => {
  sharedSession = await aPendingSession();
});

const sessionFor = async (served: boolean): Promise<TestClient> =>
  served ? aPendingSession() : sharedSession;

/**
 * The rate limit on code-sending endpoints counts per client address before the gate, 5 per ten
 * minutes, and the shared session's sign-in used one.
 */
const sharedSessionFromAFreshAddress = (): Pick<TestClient, "fetch"> => {
  const fresh = app().client();
  return {
    fetch: (path, init) => {
      const headers = new Headers(init?.headers);
      headers.set("cookie", sharedSession.cookies());
      return fresh.fetch(path, { ...init, headers });
    },
  };
};

const refusedAsPending = async (answered: Response): Promise<boolean> => {
  if (answered.status === 302)
    return answered.headers.get("location")?.startsWith("/confirm") ?? false;
  const body: unknown = await answered.json().catch(() => undefined);
  return JSON.stringify(body ?? "").includes('"second-factor-pending"');
};

const procedureDef = z.object({ type: z.string() });

/** A tRPC procedure is a function whose `_def` tRPC types only internally, so it is parsed here. */
const typeOf = (procedure: unknown): string =>
  procedureDef.parse(typeof procedure === "function" ? Reflect.get(procedure, "_def") : undefined)
    .type;

const PROCEDURES = Object.entries(appRouter._def.procedures).map(
  ([path, procedure]) => [path, typeOf(procedure)] as const,
);

const askedOver = (client: TestClient, path: string, type: string): Promise<Response> =>
  type === "query"
    ? client.fetch(`${TRPC_ENDPOINT}/${path}`)
    : client.json(`${TRPC_ENDPOINT}/${path}`, {});

describe("tRPC procedures open to a pending session", () => {
  it("lists only procedures that exist in the router", () => {
    const held = new Set(PROCEDURES.map(([path]) => path));
    expect([...PENDING_PROCEDURES.keys()].filter((path) => !held.has(path))).toEqual([]);
    expect([...PENDING_PROCEDURES.keys()].sort()).toEqual([
      "person.secondFactor",
      "session.operator",
    ]);
  });

  it.each(PROCEDURES)("refuses %s to a pending session unless it is listed", async (path, type) => {
    const answered = await askedOver(await sessionFor(PENDING_PROCEDURES.has(path)), path, type);

    expect(await refusedAsPending(answered)).toBe(!PENDING_PROCEDURES.has(path));
  });
});

type Mounted = {
  readonly path?: string;
  readonly options?: { readonly method?: string | readonly string[] };
};

const ENDPOINTS = Object.values<Mounted>(asBuilt.api).flatMap((endpoint) => {
  const method = endpoint.options?.method;
  const first = typeof method === "string" ? method : method?.[0];
  return endpoint.path === undefined || first === undefined
    ? []
    : [[endpoint.path, first] as const];
});

const OPEN_TO_A_PENDING_SESSION = new Set([
  ...PENDING_LIBRARY_PATHS.keys(),
  ...SESSIONLESS_LIBRARY_PATHS,
  AUTHORIZE_PATH,
]);

const UNSUPPORTED_MEDIA_TYPE = 415;

/** Sends JSON first. A form-only path answers 415 before any gate, so the call is repeated as a form. */
const callLibraryEndpoint = async (
  client: Pick<TestClient, "fetch">,
  path: string,
  method: string,
) => {
  const concrete = path.replaceAll(/:\w+/g, "x");
  if (method === "GET") return client.fetch(concrete, { redirect: "manual" });
  const asJson = await client.fetch(concrete, {
    method,
    headers: { "content-type": "application/json" },
    body: "{}",
    redirect: "manual",
  });
  if (asJson.status !== UNSUPPORTED_MEDIA_TYPE) return asJson;
  return client.fetch(concrete, {
    method,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "",
    redirect: "manual",
  });
};

const SERVED = ENDPOINTS.filter(([path]) => OPEN_TO_A_PENDING_SESSION.has(path));

const GATED = ENDPOINTS.filter(([path]) => !OPEN_TO_A_PENDING_SESSION.has(path));

describe("Better Auth endpoints open to a pending session", () => {
  it("finds both open and gated endpoints", () => {
    expect({ served: SERVED.length > 0, gated: GATED.length > 0 }).toEqual({
      served: true,
      gated: true,
    });
  });

  it("lists only paths that Better Auth mounts", () => {
    const mounted = new Set(ENDPOINTS.map(([path]) => path));
    expect([...OPEN_TO_A_PENDING_SESSION].filter((path) => !mounted.has(path))).toEqual([]);
  });

  it.each(SERVED)("serves %s to a pending session", async (path, method) => {
    const answered = await callLibraryEndpoint(await aPendingSession(), path, method);

    expect(await refusedAsPending(answered)).toBe(false);
  });

  it.each(GATED)("refuses %s to a pending session or answers 404", async (path, method) => {
    const answered = await callLibraryEndpoint(sharedSessionFromAFreshAddress(), path, method);

    const pending = await refusedAsPending(answered);
    const absent = answered.status === 404;
    expect([pending, absent]).toContain(true);
  });
});

const API_ROUTES = {
  "GET /me": "refused",
  "GET /consent": "refused",
  "POST /consent": "refused",
  "POST /authenticator/start": "refused",
  "POST /authenticator/finish": "refused",
  "POST /passkeys/add-options": "refused",
  "POST /passkeys/add": "refused",
  "POST /second-factor/replace/authenticator-start": "refused",
  "POST /second-factor/replace/authenticator-finish": "refused",
  "POST /second-factor/confirm/passkey-options": "open",
  "POST /second-factor/confirm/passkey": "open",
  "POST /second-factor/confirm/authenticator": "open",
  "POST /second-factor/recovery": "open",
  "POST /second-factor/restore": "open",
  "POST /passkeys/sign-in-options": "open",
  "POST /passkeys/sign-in": "open",
  "POST /sign-in-link/describe": "open",
  "POST /sign-in-link/sign-in": "open",
  "GET /health": "open",
  "GET /fonts/geist/*": "open",
  "GET /fonts/geist-mono/*": "open",
  "GET /.well-known/oauth-protected-resource": "open",
  "GET /.well-known/oauth-protected-resource/mcp": "open",
} as const;

const callApiRoute = (client: TestClient, method: string, path: string): Promise<Response> => {
  const asked = `${path}?sig=x`;
  if (method === "GET") {
    return client.fetch(asked, { redirect: "manual", headers: { "sec-fetch-dest": "document" } });
  }
  return path === "/consent"
    ? client.form(asked, { accept: "true" })
    : client.fetch(asked, {
        method,
        redirect: "manual",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
};

const mountedRoutes = (): readonly string[] =>
  [
    ...new Set(
      app()
        .server.routes.filter((route) => route.method === "GET" || route.method === "POST")
        .map((route) => `${route.method} ${route.path}`),
    ),
  ].sort();

describe("the api's own routes and a pending session", () => {
  it("lists exactly the GET and POST routes the api mounts", () => {
    expect(mountedRoutes()).toEqual(Object.keys(API_ROUTES).sort());
  });

  it.each(Object.entries(API_ROUTES))(
    "treats %s as %s for a pending session",
    async (route, held) => {
      const [method = "", path = ""] = route.split(" ");
      const client = await sessionFor(held === "open");
      const answered = await callApiRoute(client, method, path);

      expect(await refusedAsPending(answered)).toBe(held === "refused");
    },
  );
});
