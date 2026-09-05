/**
 * The copy-paste gate: jscpd over `jscpd.config.mjs`.
 *
 * jscpd reads a `.jscpd.json` of its own, and this repository deliberately does not have
 * one. The exclusions are decisions — a registry that is installed rather than written, a
 * generated file, a lift edited upstream — and a decision has to carry its reason, which
 * strict JSON has nowhere to put. So the values live in a JavaScript module, this file turns
 * them into jscpd's command line, and the tool is handed no config file to half-read.
 *
 * The binary is resolved through the module graph rather than assembled from the repository
 * root, because pnpm puts a package's executable where that package can reach it and a
 * wrong path would fail as loudly as a passing gate.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { jscpdArgv } from "../packages/devtools/src/jscpd.ts";
import { jscpdConfig } from "../jscpd.config.mjs";

const require = createRequire(import.meta.url);
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
