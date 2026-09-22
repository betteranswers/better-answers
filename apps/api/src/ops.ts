import { writeFile } from "node:fs/promises";

import { Pool } from "pg";

import { systemClock } from "@better-answers/core/kernel";
import { closeObjects, openObjects } from "@better-answers/core/store/objects";

import { readIdentityBootstrap, readObjectStore, requireBootstrap } from "./config.ts";
import { fetchHonouringHost } from "./ops/http-fetch.ts";
import { runOps } from "./ops/index.ts";
import { readTreeUnder } from "./ops/read-tree.ts";

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

  writeReport: async (path, body) => {
    await writeFile(path, body, "utf8");
  },

  readTree: readTreeUnder,

  clock: systemClock(),
}).finally(async () => {
  if (objects !== undefined) closeObjects(objects);
  await pool.end();
});

process.exit(exitCode);
