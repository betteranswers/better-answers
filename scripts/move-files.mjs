#!/usr/bin/env node
import { inventoryFailed, moveFiles, reportOf } from "../packages/devtools/src/moves/move-files.ts";

const USAGE = "usage: move-files <moves.tsv> [--dry-run]\n";

const STOPPED = new Map([
  ["SIGINT", 130],
  ["SIGTERM", 143],
]);

const workingTree = process.cwd();
const [table, ...flags] = process.argv.slice(2);

if (!table || flags.some((flag) => flag !== "--dry-run")) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const stop = new AbortController();
let stoppedBy = "";
for (const signal of STOPPED.keys()) {
  process.once(signal, () => {
    stoppedBy = signal;
    stop.abort();
  });
}

try {
  const report = await moveFiles(workingTree, table, flags.includes("--dry-run"), stop.signal);
  process.stdout.write(reportOf(report));
  if (inventoryFailed(report)) process.exitCode = 1;
} catch (cause) {
  if (stoppedBy !== "") {
    process.stderr.write(`move-files: stopped by ${stoppedBy}; the tree is as it was before\n`);
    process.exit(STOPPED.get(stoppedBy));
  }
  process.stderr.write(`move-files: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
}
