import { fileURLToPath } from "node:url";

import { environmentOf, type TierProcess } from "./config.ts";

const ENTRIES = {
  api: "main.ts",
  migrate: "migrate.ts",
} satisfies Record<TierProcess, string>;

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
process.execve(process.execPath, [process.execPath, entry], environmentOf(named));
