import { fileURLToPath } from "node:url";

import { environmentOf, type TierProcess } from "./config.ts";

const ENTRIES = {
  api: "main.ts",
  migrate: "migrate.ts",
  ops: "ops.ts",
} satisfies Record<TierProcess, string>;

/** Docker's `init` would hold every container variable at PID 1, readable by the app's uid. tini at PID 1 holds the kept keys. */
const INIT = "/usr/bin/tini";

/** The base image's `node` user, which owns `/data/git`. */
const APP_UID = 1000;

const isTierProcess = (name: string | undefined): name is TierProcess =>
  name !== undefined && Object.hasOwn(ENTRIES, name);

const named = process.argv[2];
if (!isTierProcess(named)) {
  process.stderr.write(
    `environment-gate: name the process to start, one of ${Object.keys(ENTRIES).join(", ")}\n`,
  );
  process.exit(2);
}
if (process.execve === undefined) {
  process.stderr.write("environment-gate: this platform cannot replace a process\n");
  process.exit(1);
}

// Docker runs health checks and `docker exec` as the image's user, root, so the app's uid
// cannot read their environment.
if (process.getuid?.() === 0) {
  process.setgroups?.([]);
  process.setgid?.(APP_UID);
  process.setuid?.(APP_UID);
}

const entry = fileURLToPath(new URL(ENTRIES[named], import.meta.url));
const argv = [process.execPath, entry, ...process.argv.slice(3)];
const [file, args] = process.pid === 1 ? [INIT, [INIT, "--", ...argv]] : [process.execPath, argv];
process.execve(file, args, environmentOf(named));
