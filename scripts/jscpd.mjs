import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { jscpdArgv } from "../packages/devtools/src/jscpd.ts";
import { jscpdConfig } from "../jscpd.config.mjs";

const require = createRequire(import.meta.url);
// Resolved through the module graph: pnpm puts a package's executable where that package
// reaches it, and a wrong path would pass as a clean gate.
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
