import { fileURLToPath } from "node:url";

import { environmentOf, type TierProcess } from "./config.ts";

const ENTRIES = {
  api: "main.ts",
  migrate: "migrate.ts",
  ops: "ops.ts",
} satisfies Record<TierProcess, string>;

/** Docker's `init` would hold every container variable at PID 1, readable by the app's uid. tini at PID 1 holds the kept keys. */
const INIT = "/usr/bin/tini";

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

const entry = fileURLToPath(new URL(ENTRIES[named], import.meta.url));
const argv = [process.execPath, entry, ...process.argv.slice(3)];
const [file, args] = process.pid === 1 ? [INIT, [INIT, "--", ...argv]] : [process.execPath, argv];
process.execve(file, args, environmentOf(named));
