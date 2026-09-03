import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";

import { startApp } from "./harness.ts";

/**
 * The local loop: the product, running, with a workspace in it and a way to sign in.
 *
 * It is the **same in-process harness the browser suite runs** (`tests/harness.ts`) — the
 * server factory over a Testcontainers Postgres, the CIMD document served in process, and
 * the email transport captured — so what a person sees here is what the suite drives.
 *
 * The problem it solves is the code. No email transport is wired until T-005, and the
 * app's logger is forbidden from ever holding a sign-in code (`[LOG1]`), so a code cannot
 * be fished out of the log — which is exactly right, and would otherwise leave the dev
 * loop unable to sign in at all. The captured transport hands each message to this file
 * instead, and this file prints it. Nothing in `apps/api/src` is involved.
 *
 * `pnpm --filter @better-answers/api run serve:local` — build the SPA first
 * (`pnpm --filter @better-answers/web run build`), because the app serves that build.
 */

const PORT = 3200;
const APP_URL = `http://127.0.0.1:${PORT}`;

/** Not a logger: the logger must never hold a code, and this is the point of the file. */
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const app = await startApp({
  webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)),
  appUrl: APP_URL,
  hostnames: {
    app: "127.0.0.1",
    mcp: "mcp.localhost",
    agent: "agent.localhost",
    apex: "localhost",
  },
  onEmail: (message) => {
    const code = /\b(\d{6})\b/.exec(message.text)?.[1];
    say("");
    say(`  A code was sent to ${message.to}`);
    say(`  ${code ?? message.text}`);
    say("");
  },
});

const workspace = await app.provision({ name: "Dogfood", adminEmail: "admin@example.test" });

serve({ fetch: app.server.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  say("");
  say(`  Better Answers is at ${APP_URL}/sign-in`);
  say(`  Workspace: ${workspace.name}`);
  say(`  Admin:     ${workspace.admin.email}`);
  say("");
  say("  Ask for a code and it will be printed here. Ctrl-C stops the database with it.");
  say("");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.stop().then(() => process.exit(0));
  });
}
