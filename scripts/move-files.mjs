#!/usr/bin/env node
import { moveFiles, reportOf } from "../packages/devtools/src/moves/move-files.ts";

const USAGE = "usage: move-files <moves.tsv> [--dry-run]\n";

const workingTree = process.cwd();
const [table, ...flags] = process.argv.slice(2);

if (!table || flags.some((flag) => flag !== "--dry-run")) {
  process.stderr.write(USAGE);
  process.exit(2);
}

try {
  process.stdout.write(reportOf(moveFiles(workingTree, table, flags.includes("--dry-run"))));
} catch (cause) {
  process.stderr.write(`move-files: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
}
