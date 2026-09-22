#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

import { rawInsertsIn, reportOf, scannedFilesUnder } from "../packages/devtools/src/insert-scan.ts";

// The tree it is run in, not the tree it lives in, so a suite can spawn it over a throwaway.
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

// A walk that read no suite file is a gate that proved nothing, never a tree without inserts.
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
  `no raw insert outside a factory in any of the ${String(files.length)} suite files read\n`,
);
