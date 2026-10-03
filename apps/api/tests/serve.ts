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

/** No email reaches this domain, so a spec meets an invitation whose email did not go. */
const UNREACHABLE = "@unreachable.example";

const app = await startApp({
  onEmail: (message) => {
    if (message.to.endsWith(UNREACHABLE)) throw new Error("the address is unreachable");
  },
  objectStore: objects,
  webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)),
  // A passkey's relying party is a domain, never an IP, so the product is served on `localhost`.
  publicUrl: `http://localhost:${port}`,
  hostnames: {
    app: "localhost",
    agent: "agent.localhost",
    apex: "apex.localhost",
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
