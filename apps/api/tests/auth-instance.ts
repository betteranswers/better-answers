import { Pool } from "pg";
import { pino } from "pino";

import { openPostgres } from "@better-answers/core/store/postgres";

import { createAuth } from "../src/auth/index.ts";
import { AUTH_SECRET, MCP_URL, PUBLIC_URL } from "./harness.ts";

/**
 * The identity provider as `createServer` builds it, for the suites that ask the instance
 * what it is rather than what it answers.
 *
 * Two of them do — the endpoint snapshot and the revocation-field declaration — and both
 * need the same thing: an instance built with the same `createAuth` and the same options
 * `server.ts` passes, because what those suites read (the endpoint table, the plugin list,
 * the user and member schemas) is decided by the option list and by nothing else.
 *
 * Every option is written out here rather than reached for from `server.ts`, which is the
 * point: a field added to `AuthDependencies` lands as a type error on this call. It has —
 * `T-037` added `appUrl` and `cookieDomain` while a suite was on another branch, and the
 * merge of two green branches was red (`T-040`).
 *
 * The pool is never connected and nothing here depends on it being. `getEndpoints` builds
 * `auth.api` synchronously from `options.plugins` at construction and nothing can add to it
 * later, so the instance is the one a running app carries whatever the database is doing.
 * Better Auth's eager initialisation does reach for the database and this pool reaches
 * nothing, so that rejection is swallowed here exactly as `createServer` reads it through
 * the health check. A real Postgres would buy those suites a container and no assertion.
 * (`[TEST2]` binds a test that touches data; neither of these touches any.)
 */

/** The instance, and the pool it was built over so a suite can end it in `afterAll`. */
type BuiltAuth = { readonly auth: ReturnType<typeof createAuth>; readonly database: Pool };

export const authAsServerBuildsIt = (): BuiltAuth => {
  const database = new Pool({ connectionString: "postgresql://unused@127.0.0.1:1/unused" });
  const auth = createAuth({
    database,
    door: openPostgres(database),
    publicUrl: PUBLIC_URL,
    mcpUrl: MCP_URL,
    secret: AUTH_SECRET,
    sendEmail: async () => {},
    fetchClientMetadataResource: async () => new Response("", { status: 404 }),
    logger: pino({ level: "silent" }),
  });
  auth.$context.catch(() => {});
  return { auth, database };
};
