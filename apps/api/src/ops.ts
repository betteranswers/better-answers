import { writeFile } from "node:fs/promises";

import { readIdentityBootstrap, readObjectStore, requireBootstrap } from "./config.ts";
import { closeDoors, openDoors } from "./doors.ts";
import { fetchHonouringHost } from "./ops/http-fetch.ts";
import { runOps } from "./ops/index.ts";
import { readTreeUnder } from "./ops/read-tree.ts";

const bootstrap = requireBootstrap("pnpm ops");
const identity = readIdentityBootstrap();
const objectStore = readObjectStore();

const doors = openDoors({
  database: bootstrap.databaseUrl,
  gitStoreDir: bootstrap.gitStoreDir,
  objectStore: objectStore.ok ? objectStore.value : undefined,
});

const stdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const exitCode = await runOps(process.argv.slice(2), doors, {
  fetch: fetchHonouringHost,
  stdin,
  say: (line) => {
    process.stdout.write(`${line}\n`);
  },
  appHostname: identity.ok ? identity.value.hostnames.app : undefined,

  writeReport: async (path, body) => {
    await writeFile(path, body, "utf8");
  },

  readTree: readTreeUnder,
}).finally(() => closeDoors(doors));

process.exit(exitCode);
