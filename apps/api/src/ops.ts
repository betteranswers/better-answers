import { Pool } from "pg";

import { systemClock } from "@better-answers/core/kernel";

import { readIdentityBootstrap, requireBootstrap } from "./config.ts";
import { fetchHonouringHost } from "./ops/http-fetch.ts";
import { runOps } from "./ops/index.ts";

/**
 * `pnpm ops <command>` — the entry point the estate's restore scripts run inside the `api`
 * image (`restore-drill.sh`, `restore-production.sh`; ADR 0022). Bootstrap is read once
 * here, as `main.ts` and `migrate.ts` read it, and everything else is an
 * argument. The identity bootstrap is optional: `migrate`'s environment has the
 * database alone, and only `smoke` wants the app hostname; the repositories' root is
 * optional for the same reason, and only `reconcile-watermark` wants it.
 */
const bootstrap = requireBootstrap("pnpm ops");
const identity = readIdentityBootstrap();
const pool = new Pool({ connectionString: bootstrap.databaseUrl });

const stdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const exitCode = await runOps(process.argv.slice(2), pool, {
  fetch: fetchHonouringHost,
  stdin,
  say: (line) => {
    process.stdout.write(`${line}\n`);
  },
  appHostname: identity.ok ? identity.value.hostnames.app : undefined,
  gitStoreDir: bootstrap.gitStoreDir,
  // A one-shot process's own Clock (ADR 0040): constructed once here, since this is a
  // separate process from the long-running server and cannot share its.
  clock: systemClock(),
}).finally(() => pool.end());

process.exit(exitCode);
