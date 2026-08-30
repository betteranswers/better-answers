import { Hono } from "hono";
import type { Pool } from "pg";

import { attempt } from "@better-answers/contracts";

/**
 * Everything the HTTP surface needs, passed in rather than reached for, so a test
 * crosses the same seam a caller does (`[DESIGN2]`, `[DESIGN3]`).
 */
export type ServerDependencies = {
  readonly database: Pool;
};

/**
 * The app tier's single Hono server (ADR 0006). B3 mounts identity, B9 the tRPC
 * router and the MCP surface; today it answers the one route the deploy unit
 * already depends on.
 */
export function createServer(dependencies: ServerDependencies): Hono {
  const server = new Hono();

  // Docker reads this endpoint every ten seconds and `worker` will not start until
  // it passes (deploy/platform.compose.yaml), so an unreachable database has to read
  // as unhealthy rather than as a running app.
  server.get("/health", async (context) => {
    const reached = await attempt(async () => {
      await dependencies.database.query("select 1");
    });

    if (!reached.ok) {
      return context.json({ status: "unhealthy", database: "unreachable" }, 503);
    }

    return context.json({ status: "healthy", database: "reachable" });
  });

  return server;
}
