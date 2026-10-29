import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { logger } from "../src/logger.ts";
import { repositoryRoot } from "./support/roots/roots.ts";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("the browser suite's api needs a port as its one argument");
}

/** Bound before the harness loads, so a taken port fails this server before another's `/health` can pass for its own. Playwright waits on 503. */
let served: Hono | undefined;
const listening = serve({
  fetch: (request) => served?.fetch(request) ?? new Response(null, { status: 503 }),
  port,
  hostname: "127.0.0.1",
});

listening.on("error", (cause: Error) => {
  logger.error({ port, reason: cause.message }, "the browser suite's api could not listen");
  process.exit(1);
});

await new Promise((bound) => listening.once("listening", bound));

const [{ openObjectStore }, { scriptedModels }, { harnessControl }, { startApp }] =
  await Promise.all([
    import("@better-answers/core/testing/warm-objects"),
    import("./support/harness/harness-asking.ts"),
    import("./support/harness/harness-control.ts"),
    import("./support/harness/harness.ts"),
  ]);

const objects = await openObjectStore("browser-suite");

const UNREACHABLE = "@unreachable.example";

const models = scriptedModels();

const app = await startApp({
  fetchModel: models.fetch,
  onEmail: (message) => {
    if (message.to.endsWith(UNREACHABLE)) throw new Error("the address is unreachable");
  },
  objectStore: objects,
  webRoot: path.join(repositoryRoot, "apps/web/dist"),
  // A passkey's relying party is a domain, never an IP, so the product is served on `localhost`.
  publicUrl: `http://localhost:${port}`,
  hostnames: {
    app: "localhost",
    agent: "agent.localhost",
    apex: "apex.localhost",
  },
});

served = withHarnessControl();
logger.info({ port }, "the browser suite's api is listening");

function withHarnessControl(): Hono {
  const outer = new Hono();
  outer.route("/", harnessControl(app, models));
  outer.all("/*", (context) => app.server.fetch(context.req.raw));
  return outer;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    listening.close(() => {
      void Promise.all([app.stop(), objects.stop()]).then(() => process.exit(0));
    });
  });
}
