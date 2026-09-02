import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";

import { logger } from "../src/logger.ts";
import { startApp } from "./harness.ts";

/**
 * The app, listening, for a caller that cannot be given a `Request` — the browser suite in
 * `apps/web/e2e`, and the dev loop when someone wants to look at the running product.
 *
 * It is the same app every endpoint test drives: the server factory over a Testcontainers
 * Postgres, with the email transport capturing codes and the CIMD document served in
 * process (`[TEST3]`). Nothing here builds a second version of it.
 *
 * The port is an argument rather than an environment variable, because the caller that
 * needs it is the one that must choose it, and `[SEC1]` keeps `src/config.ts` the tier's
 * only reader of the environment.
 */

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("the browser suite's app needs a port as its one argument");
}

/**
 * `app.` is the loopback here, because that is the hostname a browser on this machine can
 * actually reach and the fence in `ingress/hostnames.ts` matches on the `Host` it arrives
 * with. Which hostname carries which path is proven in `tests/hostnames.test.ts`; this
 * suite is about what a browser does with the screens `app.` serves.
 */
const app = await startApp({
  webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)),
  hostnames: {
    app: "127.0.0.1",
    mcp: "mcp.localhost",
    agent: "agent.localhost",
    apex: "localhost",
  },
});

const listening = serve({ fetch: app.server.fetch, port, hostname: "127.0.0.1" }, (address) => {
  logger.info({ port: address.port }, "the browser suite's app is listening");
});

// Playwright ends the run by signalling this process; the database it started goes with it
// rather than waiting for the container reaper.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    listening.close(() => {
      void app.stop().then(() => process.exit(0));
    });
  });
}
