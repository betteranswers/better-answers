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
 * The app tier's single Hono server (ADR 0006). B3 mounts identity, B9 the tRPC router
 * and the MCP surface; today it answers one route.
 *
 * Why this tier has an endpoint in B1 at all, when the worker has no HTTP server:
 * `[TEST1]` defines a functional test differently per tier — "for `app/`, the endpoint
 * (`app.request()`); for `worker/`, the job or module entry point". So the app cannot
 * have a functional test until it has a route, and the worker can. `/health` is the
 * route chosen because it is one the deploy unit will need
 * (`deploy/platform.compose.yaml`) rather than one invented for the test; the worker's
 * own health server, which that same file reads at `:8000`, is B4's.
 */
export function createServer(dependencies: ServerDependencies): Hono {
  const server = new Hono();

  // Docker reads this every ten seconds and holds `worker` back until it passes, so an
  // unreachable database has to read as unhealthy rather than as a running app.
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
