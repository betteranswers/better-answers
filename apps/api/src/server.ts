import { Hono } from "hono";
import type { Pool } from "pg";
import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";
import { openPostgres } from "@better-answers/core/store/postgres";

import { createClientMetadataFetcher } from "../lifts/better-auth-cimd-node/index.ts";
import {
  CIMD_FETCH_TIMEOUT_MS,
  CIMD_RESPONSE_CAP_BYTES,
  createAuth,
  createAuthRoutes,
  createTokenVerifier,
  type EmailSender,
} from "./auth/index.ts";
import { logger as tierLogger } from "./logger.ts";
import { createMcpSurface } from "./mcp/surface.ts";

/**
 * Everything the HTTP surface needs, passed in rather than reached for, so a test
 * crosses the same seam a caller does (`[DESIGN2]`, `[DESIGN3]`).
 */
export type ServerDependencies = {
  readonly database: Pool;
  /** The https origin the authorization server issues from; the MCP URL is `${publicUrl}/mcp`. */
  readonly publicUrl: string;
  readonly authSecret: string;
  readonly sendEmail: EmailSender;
  readonly logger?: Logger;
  /** The CIMD transport; the lift by default, an in-process document in a test. */
  readonly fetchClientMetadataResource?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly serverVersion?: string;
};

/**
 * The app tier's single Hono server (ADR 0006). B3 mounts identity and the MCP
 * surface here; B9 the tRPC router.
 *
 * Why this tier has an endpoint in B1 at all, when the worker has no HTTP server:
 * `[TEST1]` defines a functional test differently per tier — "for `apps/api`, the endpoint
 * (`app.request()`); for `apps/worker`, the job or module entry point". So the tier cannot
 * have a functional test until it has a route, and the worker can. `/health` is the
 * route chosen because it is one the deploy unit will need
 * (`deploy/platform.compose.yaml`) rather than one invented for the test; the worker's
 * own health server, which that same file reads at `:8000`, is B4's.
 */
export function createServer(dependencies: ServerDependencies): Hono {
  const server = new Hono();
  const logger = dependencies.logger ?? tierLogger;
  const door = openPostgres(dependencies.database);
  const mcpUrl = `${dependencies.publicUrl}/mcp`;

  const auth = createAuth({
    database: dependencies.database,
    door,
    publicUrl: dependencies.publicUrl,
    mcpUrl,
    secret: dependencies.authSecret,
    sendEmail: dependencies.sendEmail,
    fetchClientMetadataResource:
      dependencies.fetchClientMetadataResource ??
      createClientMetadataFetcher({
        timeoutMs: CIMD_FETCH_TIMEOUT_MS,
        maxBodyBytes: CIMD_RESPONSE_CAP_BYTES,
      }),
    logger,
  });

  // Better Auth initialises eagerly (its JWKS and the resource row). A failure while
  // Postgres stays reachable would otherwise leave the app "healthy" and every OAuth
  // and MCP request failing; the health check reads this and answers 503 instead.
  let identity: "starting" | "ready" | "failed" = "starting";
  auth.$context.then(
    () => {
      identity = "ready";
    },
    (cause: unknown) => {
      identity = "failed";
      logger.error(
        { reason: cause instanceof Error ? cause.message : String(cause) },
        "identity provider failed to initialise",
      );
    },
  );

  // Docker reads this every ten seconds and holds `worker` back until it passes, so an
  // unreachable database has to read as unhealthy rather than as a running app.
  server.get("/health", async (context) => {
    const reached = await attempt(async () => {
      await dependencies.database.query("select 1");
    });

    if (!reached.ok) {
      return context.json({ status: "unhealthy", database: "unreachable", identity }, 503);
    }
    if (identity === "failed") {
      return context.json({ status: "unhealthy", database: "reachable", identity }, 503);
    }

    return context.json({ status: "healthy", database: "reachable", identity });
  });

  server.route(
    "/",
    createAuthRoutes({ auth, door, publicUrl: dependencies.publicUrl, mcpUrl, logger }),
  );

  const mcp = createMcpSurface({
    door,
    verifier: createTokenVerifier({
      issuer: dependencies.publicUrl,
      audience: mcpUrl,
      jwks: () => auth.api.getJwks(),
    }),
    publicUrl: dependencies.publicUrl,
    mcpUrl,
    logger,
    serverVersion: dependencies.serverVersion ?? "0.1.0",
  });
  // The seam ADR 0030 names: `(Request, { authInfo }) => Response`, authentication
  // resolved inside `mcp` before the handler sees the request.
  server.all("/mcp", (context) => mcp(context.req.raw));

  // Better Auth's own endpoints — discovery, /oauth2/*, /jwks, the email-code and
  // organisation endpoints — answer everything the routes above did not. Host-based
  // routing (`agent.` to `/agent/v1/*` alone, ADR 0022) is the deploy task's.
  server.all("/*", (context) => auth.handler(context.req.raw));

  return server;
}
