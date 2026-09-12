import { writeFile } from "node:fs/promises";

import { Pool } from "pg";

import { systemClock } from "@better-answers/core/kernel";
import { closeObjects, openObjects } from "@better-answers/core/store/objects";

import { readIdentityBootstrap, readObjectStore, requireBootstrap } from "./config.ts";
import { fetchHonouringHost } from "./ops/http-fetch.ts";
import { runOps } from "./ops/index.ts";

/**
 * `pnpm ops <command>` — the entry point the estate's restore scripts run inside the `api`
 * image (`restore-drill.sh`, `restore-production.sh`; ADR 0022). Bootstrap is read once
 * here, as `main.ts` and `migrate.ts` read it, and everything else is an
 * argument. The identity bootstrap is optional: `migrate`'s environment has the
 * database alone, and only `smoke` wants the app hostname; the repositories' root is
 * optional for the same reason, and only `reconcile-watermark` wants it. The object store
 * is optional on the same terms — only the two erasure commands open that door — and a
 * reading or an opening that fails leaves the door absent rather than stopping the process,
 * because those two commands refuse for themselves and name what is missing.
 */
const bootstrap = requireBootstrap("pnpm ops");
const identity = readIdentityBootstrap();
const objectStore = readObjectStore();
const opened = objectStore.ok ? openObjects(objectStore.value) : undefined;
const objects = opened?.ok === true ? opened.value : undefined;
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
  objects,
  // `--report <file>`, injected for the reason `stdin` above is: the command that asks for a
  // report never touches the filesystem itself, so the seam a suite drives is the whole of it.
  writeReport: async (path, body) => {
    await writeFile(path, body, "utf8");
  },
  // A one-shot process's own Clock (ADR 0040): constructed once here, since this is a
  // separate process from the long-running server and cannot share its.
  clock: systemClock(),
}).finally(async () => {
  if (objects !== undefined) closeObjects(objects);
  await pool.end();
});

process.exit(exitCode);
