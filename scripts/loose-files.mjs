#!/usr/bin/env node
import { trackedFiles } from "../packages/devtools/src/paths.ts";
import {
  countsIn,
  findingsFor,
  LOOSE_FILE_LIMIT,
} from "../packages/devtools/src/scans/loose-files.ts";

const workingTree = process.cwd();

let counts;
try {
  counts = countsIn(trackedFiles(workingTree));
} catch (cause) {
  process.stderr.write(`loose-files: the listing did not finish: ${String(cause)}\n`);
  process.exit(2);
}

if (counts.size === 0) {
  process.stderr.write("loose-files: no tracked file under a source or test tree\n");
  process.exit(2);
}

const found = findingsFor(counts);

for (const one of found) process.stdout.write(`${one}\n`);

if (found.length > 0) process.exit(1);

process.stdout.write(
  `each of the ${String(counts.size)} folders read holds ${String(LOOSE_FILE_LIMIT)} tracked files or fewer, or exactly its cap\n`,
);
