import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { hostnameOfUrl, originOfUrl } from "../src/ingress/hostnames.ts";
import { startApp } from "./harness.ts";

const PORT = 3200;
const LOOPBACK_URL = `http://127.0.0.1:${PORT}`;

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const originArgument = (argument: string | undefined): string => {
  if (argument === undefined) return LOOPBACK_URL;

  const parsed = URL.parse(argument);
  if (parsed === null || parsed.origin === "null") {
    throw new Error(
      `the local loop's one argument is the origin the api is reached on, e.g. https://<name>.trycloudflare.com; got ${argument}`,
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
