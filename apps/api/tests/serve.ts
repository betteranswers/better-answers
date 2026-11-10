import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { rootsOf } from "@better-answers/schema/testing/roots";

import { logger } from "../src/logger.ts";

const { repositoryRoot } = rootsOf(import.meta.url);

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("the browser suite's api needs a port as its one argument");
}

/** Listens before the harness loads, so a taken port fails at once instead of another server's `/health` passing for this one. Playwright retries on 503. */
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
  // WebAuthn needs a domain as the relying party, not an IP address, so the product uses `localhost`.
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
