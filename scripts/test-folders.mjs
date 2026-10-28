#!/usr/bin/env node
import { trackedFiles } from "../packages/devtools/src/paths.ts";
import { reportFor } from "../packages/devtools/src/scans/test-folders.ts";

const workingTree = process.cwd();

let report;
try {
  report = reportFor(trackedFiles(workingTree));
} catch (cause) {
  process.stderr.write(`test-folders: the listing did not finish: ${String(cause)}\n`);
  process.exit(2);
}

if (report.read === 0) {
  process.stderr.write("test-folders: no tracked file under a test tree\n");
  process.exit(2);
}

for (const one of report.findings) process.stdout.write(`${one}\n`);

if (report.findings.length > 0) process.exit(1);

process.stdout.write(
  `each of the ${String(report.read)} test folders read mirrors a source folder or is a named kind\n`,
);
