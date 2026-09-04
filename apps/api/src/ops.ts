import { Pool } from "pg";

import { readIdentityBootstrap, requireBootstrap } from "./config.ts";
import { fetchHonouringHost } from "./ops/http-fetch.ts";
import { runOps } from "./ops/index.ts";

/**
 * `pnpm ops <command>` — the entry point the estate's restore scripts run inside the `api`
 * image (`restore-drill.sh`, `restore-production.sh`; ADR 0022). Bootstrap is read once
 * here, as `main.ts` and `migrate.ts` read it (`[APP2]`), and everything else is an
 * argument. The identity bootstrap is optional: `migrate`'s environment has the
 * database alone, and only `smoke` wants the app hostname.
 */
const bootstrap = requireBootstrap("pnpm ops");
const identity = readIdentityBootstrap();
const pool = new Pool({ connectionString: bootstrap.databaseUrl });

const stdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

// pnpm inserts a literal `--` when it forwards arguments through the workspace `ops`
// script (`pnpm ops replay-erasures` arrives as `node src/ops.ts -- replay-erasures`;
// first drill, 04/09/2026) — it is a separator, never a command.
const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();

const exitCode = await runOps(argv, pool, {
  fetch: fetchHonouringHost,
  stdin,
  say: (line) => {
    process.stdout.write(`${line}\n`);
  },
  appHostname: identity.ok ? identity.value.hostnames.app : undefined,
}).finally(() => pool.end());

process.exit(exitCode);
