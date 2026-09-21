import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import { logger } from "../src/logger.ts";
import { harnessControl } from "./harness-control.ts";
import { startApp } from "./harness.ts";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("the browser suite's app needs a port as its one argument");
}

const app = await startApp({
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
    logger.info({ port: address.port }, "the browser suite's app is listening");
  },
);

function withHarnessControl(): Hono {
  const outer = new Hono();
  outer.route("/", harnessControl(app));
  outer.all("/*", (context) => app.server.fetch(context.req.raw));
  return outer;
}

listening.on("error", (cause: Error) => {
  logger.error({ port, reason: cause.message }, "the browser suite's app could not listen");
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    listening.close(() => {
      void app.stop().then(() => process.exit(0));
    });
  });
}
