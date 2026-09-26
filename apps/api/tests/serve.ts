import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { openObjectStore } from "@better-answers/core/testing/warm-objects";

import { logger } from "../src/logger.ts";
import { harnessControl } from "./harness-control.ts";
import { startApp } from "./harness.ts";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("the browser suite's api needs a port as its one argument");
}

/** The Sources screen binds a document, and a bind puts its bytes in the object store first. */
const objects = await openObjectStore("browser-suite");

const app = await startApp({
  objectStore: objects,
  webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)),
  publicUrl: `http://127.0.0.1:${port}`,
  hostnames: {
    app: "127.0.0.1",
    agent: "agent.localhost",
    apex: "localhost",
  },
});

const listening = serve(
  { fetch: withHarnessControl().fetch, port, hostname: "127.0.0.1" },
  (address) => {
    logger.info({ port: address.port }, "the browser suite's api is listening");
  },
);

function withHarnessControl(): Hono {
  const outer = new Hono();
  outer.route("/", harnessControl(app));
  outer.all("/*", (context) => app.server.fetch(context.req.raw));
  return outer;
}

listening.on("error", (cause: Error) => {
  logger.error({ port, reason: cause.message }, "the browser suite's api could not listen");
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    listening.close(() => {
      void Promise.all([app.stop(), objects.stop()]).then(() => process.exit(0));
    });
  });
}
