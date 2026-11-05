#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  rawInsertsIn,
  reportOf,
  scannedFilesUnder,
} from "../packages/devtools/src/scans/insert-scan.ts";

/** The working directory, not this file's tree, so a test can run it over a throwaway tree. */
const root = process.cwd();
const roots = process.argv.slice(2);

if (roots.length === 0) {
  process.stderr.write("insert-scan: name at least one directory to read\n");
  process.exit(2);
}

let files;
try {
  files = scannedFilesUnder(root, roots);
} catch (cause) {
  process.stderr.write(`insert-scan: the walk did not finish: ${String(cause)}\n`);
  process.exit(2);
}

// If the walk read no suite file, the gate proved nothing, so refuse instead of passing.
if (files.length === 0) {
  process.stderr.write(`insert-scan: no suite file under ${roots.join(", ")}\n`);
  process.exit(2);
}

const found = files.flatMap((file) =>
  rawInsertsIn(file, readFileSync(path.join(root, file), "utf8")),
);

for (const one of found) process.stdout.write(`${reportOf(one)}\n`);

if (found.length > 0) process.exit(1);

process.stdout.write(
  `none of the ${String(files.length)} suite files checked has a raw insert outside a factory\n`,
);
