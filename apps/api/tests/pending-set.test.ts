import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AUTHORIZE_PATH,
  PENDING_LIBRARY_PATHS,
  PENDING_PROCEDURES,
  SESSIONLESS_LIBRARY_PATHS,
} from "../src/second-factor-gate.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { appRouter } from "../src/trpc/router.ts";
import { authAsBuiltForSuite } from "./auth-instance.ts";
import { holdAnAuthenticator } from "./factor-harness.ts";
import type { TestClient } from "./harness.ts";
import { signedInByEmailOnly } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const asBuilt = authAsBuiltForSuite();

/** An Admin holding an authenticator, signed in by email alone: pending, its workspace chosen. */
const aPendingSession = async (): Promise<TestClient> => {
  const workspace = await app().provision();
  await holdAnAuthenticator(app(), workspace.admin.id);
  return signedInByEmailOnly(app(), workspace.admin.email);
};

/** Every transport answers a pending session in the one word, or sends it to confirm. */
const refusedAsPending = async (answered: Response): Promise<boolean> => {
  if (answered.status === 302)
    return answered.headers.get("location")?.startsWith("/confirm") ?? false;
  const body: unknown = await answered.json().catch(() => undefined);
  return JSON.stringify(body ?? "").includes('"second-factor-pending"');
};

const procedureDef = z.object({ type: z.string() });

/** A procedure is a function carrying its definition, which tRPC types by its own internals. */
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

describe("the pending set over tRPC", () => {
  it("names only procedures the router holds", () => {
    const held = new Set(PROCEDURES.map(([path]) => path));
    expect([...PENDING_PROCEDURES.keys()].filter((path) => !held.has(path))).toEqual([]);
    expect([...PENDING_PROCEDURES.keys()].sort()).toEqual([
      "person.secondFactor",
      "session.operator",
    ]);
  });

  it.each(PROCEDURES)("answers %s to a pending session as the set says", async (path, type) => {
    const answered = await askedOver(await aPendingSession(), path, type);

    expect(await refusedAsPending(answered)).toBe(!PENDING_PROCEDURES.has(path));
  });
});

type Mounted = {
  readonly path?: string;
  readonly options?: { readonly method?: string | readonly string[] };
};

/** Read off the instance, so an endpoint a plugin adds on an upgrade is enumerated here too. */
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

/** JSON first; a path that takes forms alone refuses it before any gate, so it is asked again. */
const askedOfTheLibrary = async (client: TestClient, path: string, method: string) => {
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

describe("the pending set in the library's endpoints", () => {
  it("names only paths the library mounts", () => {
    const mounted = new Set(ENDPOINTS.map(([path]) => path));
    expect([...OPEN_TO_A_PENDING_SESSION].filter((path) => !mounted.has(path))).toEqual([]);
  });

  it.each(ENDPOINTS)("answers %s to a pending session as the set says", async (path, method) => {
    const answered = await askedOfTheLibrary(await aPendingSession(), path, method);

    const pending = await refusedAsPending(answered);
    const absent = answered.status === 404;
    // An open path never meets the gate; any other meets it, or is closed before any gate.
    expect(OPEN_TO_A_PENDING_SESSION.has(path) ? pending : !(pending || absent)).toBe(false);
  });
});

/** Written out, as the routes the api mounts beside the library and tRPC answer a pending session. */
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
  "GET /.well-known/oauth-protected-resource": "open",
  "GET /.well-known/oauth-protected-resource/mcp": "open",
} as const;

/** A signed query, as a consent page carries; consent takes a form navigation alone. */
const askedOfTheApi = (client: TestClient, method: string, path: string): Promise<Response> => {
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

describe("the pending set in the api's own routes", () => {
  it("names every route the api mounts, and nothing else", () => {
    expect(mountedRoutes()).toEqual(Object.keys(API_ROUTES).sort());
  });

  it.each(Object.entries(API_ROUTES))(
    "answers %s to a pending session as %s",
    async (route, held) => {
      const [method = "", path = ""] = route.split(" ");
      const client = await aPendingSession();
      const answered = await askedOfTheApi(client, method, path);

      expect(await refusedAsPending(answered)).toBe(held === "refused");
    },
  );
});
