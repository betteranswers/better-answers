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
import { apexCookieDomain, routeByHostname, type PublicHostnames } from "./ingress/hostnames.ts";
import { serveSpa } from "./ingress/spa.ts";
import { logger as tierLogger } from "./logger.ts";
import { createMcpSurface } from "./mcp/surface.ts";
import { createTrpcRoutes } from "./trpc/index.ts";

/**
 * Everything the HTTP surface needs, passed in rather than reached for, so a test
 * crosses the same seam a caller does (`[DESIGN2]`, `[DESIGN3]`).
 */
export type ServerDependencies = {
  readonly database: Pool;
  /** The https origin the authorization server issues from; the MCP URL is `${publicUrl}/mcp`. */
  readonly publicUrl: string;
  /**
   * The origin the SPA is served from. `https://<app hostname>` in the estate; a caller
   * that serves the build somewhere else — the browser suite on a loopback port — says so,
   * because Better Auth sends the person to this origin's `/sign-in` and `/choose-workspace`
   * and a wrong scheme or port is a redirect into nothing.
   */
  readonly appUrl: string;
  /** The estate's four hostnames (ADR 0022); the fence in `ingress/hostnames.ts` is built from them. */
  readonly hostnames: PublicHostnames;
  readonly authSecret: string;
  readonly sendEmail: EmailSender;
  readonly logger?: Logger;
  /** The CIMD transport; the lift by default, an in-process document in a test. */
  readonly fetchClientMetadataResource?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly serverVersion?: string;
  /** Where `apps/web`'s static build was written; absent means this process serves no SPA. */
  readonly webRoot?: string | undefined;
};

/**
 * The app tier's single Hono server (ADR 0006). B3 mounts identity and the MCP
 * surface here.
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

  // Ahead of every mount below, so a path outside its hostname's surface is refused
  // before a counter, a session read or a body (T-030; the list is
  // `ingress/hostnames.ts`).
  server.use("*", routeByHostname(dependencies.hostnames, logger));

  const auth = createAuth({
    database: dependencies.database,
    door,
    publicUrl: dependencies.publicUrl,
    appUrl: dependencies.appUrl,
    mcpUrl,
    cookieDomain: apexCookieDomain(dependencies.hostnames),
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
  const identityInit = auth.$context.then(
    () => {
      identity = "ready";
    },
    (cause: unknown) => {
      identity = "failed";
      logger.error(
        { reason: cause instanceof Error ? cause.message : String(cause) },
        "the authorization server failed to initialise",
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
    // Healthy means ready to serve: the init is awaited (it settles once), so the
    // deploy unit never starts `worker` while OAuth and MCP cannot answer.
    await identityInit;
    if (identity !== "ready") {
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

  // The product's own transport, on the origin the SPA is served from (ADR 0008).
  server.route("/", createTrpcRoutes({ auth, door }));

  // The files the SPA's build holds, on `app.` (ADR 0006, amended 2026-09-02) — the
  // hashed bundles and the shell at `/`. A file lookup claims nothing it does not hold, so
  // it is safe here, after every route this process owns and before the wildcard.
  const spa = serveSpa({ root: dependencies.webRoot, hostname: dependencies.hostnames.app });
  server.use("*", spa.assets);

  // Better Auth's own endpoints — discovery, /oauth2/*, /jwks, the email-code and
  // organisation endpoints — answer everything the routes above did not, on every
  // hostname this process is given. Which hostname reaches which path is decided
  // before this mount, by the hostname fence at the top of this function and the one
  // list in `ingress/hostnames.ts` (T-030); the tunnel's ingress rules are the first
  // fence and stay so (ADR 0022).
  server.all("/*", async (context) => {
    const answered = await auth.handler(context.req.raw);
    // A screen's address is a path nothing on disk holds and the authorization server does
    // not know. It is answered here, after that server has declined, so no endpoint of it
    // can be shadowed by the shell — its set grows with the library, and a shell that
    // guessed which paths were its own would be wrong on the next upgrade.
    if (answered.status !== 404) return answered;
    return (await spa.shell(context)) ?? answered;
  });

  return server;
}
