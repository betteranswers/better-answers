import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { jscpdConfig } from "../jscpd.config.mjs";
import { jscpdArgv } from "../packages/devtools/src/scans/jscpd.ts";

const require = createRequire(import.meta.url);
/** Where pnpm installs jscpd's executable. A wrong path would make the gate pass without running. */
const binary = path.join(path.dirname(require.resolve("jscpd/package.json")), "run-jscpd.js");

const run = spawnSync(binary, [...jscpdArgv(jscpdConfig)], {
  cwd: path.resolve(import.meta.dirname, ".."),
  stdio: "inherit",
});

if (run.error !== undefined) {
  process.stderr.write(`jscpd could not be run: ${run.error.message}\n`);
  process.exit(2);
}

process.exit(run.status ?? 2);
