import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";

import { hostnameOfUrl, originOfUrl } from "../src/ingress/hostnames.ts";
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
 * `pnpm --filter @better-answers/api run serve:local [origin]` — build the SPA first
 * (`pnpm --filter @better-answers/web run build`), because the app serves that build.
 *
 * The one optional argument is the origin the app is reached on when it is not the
 * loopback: a Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:3200`)
 * in front of this port, so a real MCP host — claude.ai — can connect as a client
 * against this issuer (T-045's re-prove; prototype 61). The issuer Better Auth
 * advertises *is* `publicUrl`, read through the same `originOfUrl` as `PUBLIC_URL` is in
 * `config.ts`, and the fence's `app` hostname is its host, derived the same way; the listener stays on the loopback port either way, because
 * that is where the tunnel forwards to. An argument rather than an environment variable,
 * in the shape of `tests/serve.ts`: `[SEC1]` keeps `src/config.ts` the tier's only reader
 * of the environment.
 */

const PORT = 3200;
const LOOPBACK_URL = `http://127.0.0.1:${PORT}`;

/** Not a logger: the logger must never hold a code, and this is the point of the file. */
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const originArgument = (argument: string | undefined): string => {
  if (argument === undefined) return LOOPBACK_URL;
  // The URL standard spells an opaque origin — a scheme with no host, such as a bare
  // `mailto:` — as the literal string "null", so that is the second way to have no origin.
  const parsed = URL.parse(argument);
  if (parsed === null || parsed.origin === "null") {
    throw new Error(
      `the local loop's one argument is the origin the app is reached on, e.g. https://<name>.trycloudflare.com; got ${argument}`,
    );
  }
  return originOfUrl(argument);
};

const publicUrl = originArgument(process.argv[2]);
const hostnames = {
  app: hostnameOfUrl(publicUrl),
  agent: "agent.localhost",
  apex: "localhost",
};
// The three must differ, as `config.ts` insists: an origin on one of the other two names
// would hand that hostname's surface to the product and fail on the first request instead.
if (hostnames.app === hostnames.agent || hostnames.app === hostnames.apex) {
  throw new Error(
    `the origin's host ${hostnames.app} is already the agent or apex hostname; use a different one`,
  );
}

const app = await startApp({
  webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)),
  publicUrl,
  hostnames,
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
  say(`  Better Answers is at ${publicUrl}/sign-in`);
  if (publicUrl !== LOOPBACK_URL) {
    say(`  Listening on ${LOOPBACK_URL} for the tunnel in front of it`);
  }
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
