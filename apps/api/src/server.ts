import { Hono } from "hono";
import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";

import { createClientMetadataFetcher } from "../lifts/better-auth-cimd-node/index.ts";
import {
  CIMD_FETCH_TIMEOUT_MS,
  CIMD_RESPONSE_CAP_BYTES,
  createAuth,
  createAuthRoutes,
  createTokenVerifier,
  type EmailSender,
} from "./auth/index.ts";
import type { Doors } from "./doors.ts";
import { routeByHostname, type PublicHostnames } from "./ingress/hostnames.ts";
import { serveSpa } from "./ingress/spa.ts";
import { logger as tierLogger } from "./logger.ts";
import { createMcpSurface } from "./mcp/surface.ts";
import { createTrpcRoutes } from "./trpc/mount.ts";

export type ServerDependencies = {
  readonly doors: Doors;

  readonly publicUrl: string;

  readonly hostnames: PublicHostnames;
  readonly authSecret: string;
  readonly sendEmail: EmailSender;
  readonly logger?: Logger;

  readonly fetchClientMetadataResource?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly serverVersion?: string;

  readonly webRoot?: string | undefined;
};

export function createServer(dependencies: ServerDependencies): Hono {
  const server = new Hono();
  const logger = dependencies.logger ?? tierLogger;
  const { doors } = dependencies;
  const door = doors.postgres;
  const mcpUrl = `${dependencies.publicUrl}/mcp`;

  server.use("*", routeByHostname(dependencies.hostnames, logger));

  const auth = createAuth({
    database: door.pool,
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

  server.get("/health", async (context) => {
    const reached = await attempt(async () => {
      await door.pool.query("select 1");
    });

    if (!reached.ok) {
      return context.json({ status: "unhealthy", database: "unreachable", identity }, 503);
    }

    await identityInit;
    if (identity !== "ready") {
      return context.json({ status: "unhealthy", database: "reachable", identity }, 503);
    }

    return context.json({ status: "healthy", database: "reachable", identity });
  });

  server.route(
    "/",
    createAuthRoutes({
      auth,
      door,
      publicUrl: dependencies.publicUrl,
      mcpUrl,
      logger,
      clock: doors.clock,
    }),
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
    clock: doors.clock,
  });

  server.all("/mcp", (context) => mcp(context.req.raw));

  server.route("/", createTrpcRoutes({ auth, doors }));

  const spa = serveSpa({ root: dependencies.webRoot, hostname: dependencies.hostnames.app });
  server.use("*", spa.assets);

  server.all("/*", async (context) => {
    const answered = await auth.handler(context.req.raw);

    if (answered.status !== 404) return answered;
    return (await spa.shell(context)) ?? answered;
  });

  return server;
}
