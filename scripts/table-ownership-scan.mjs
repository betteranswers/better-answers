#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  scannedFilesUnder,
  sliceOf,
  slicesUnder,
  tablesReadIn,
  undeclaredIn,
  unreadIn,
  WHERE_THE_MAP_LIVES,
} from "../packages/devtools/src/table-ownership-scan.ts";

/** The tree it is run in, not the tree it lives in, so a suite can spawn it over a throwaway. */
const root = process.cwd();
const roots = process.argv.slice(2);

if (roots.length === 0) {
  process.stderr.write("table-ownership-scan: name at least one directory to read\n");
  process.exit(2);
}

let map;
let files;
let reads;
try {
  map = await import(pathToFileURL(path.join(root, WHERE_THE_MAP_LIVES)).href);
  const slices = slicesUnder(root, map.OWNERS_OUTSIDE_CORE);
  files = scannedFilesUnder(root, roots);
  reads = files.flatMap((file) =>
    tablesReadIn(file, readFileSync(path.join(root, file), "utf8")).map((read) => ({
      ...read,
      slice: sliceOf(file, slices),
    })),
  );
} catch (cause) {
  process.stderr.write(`table-ownership-scan: the scan did not finish: ${String(cause)}\n`);
  process.exit(2);
}

// A walk that read no file, or a map that names no table, is a gate that proved nothing.
if (files.length === 0 || Object.keys(map.TABLE_OWNERS ?? {}).length === 0) {
  process.stderr.write(
    `table-ownership-scan: no source file under ${roots.join(", ")}, or no table in the map\n`,
  );
  process.exit(2);
}

const found = [...undeclaredIn(map, reads), ...unreadIn(map, reads)];

for (const one of found) process.stdout.write(`${one}\n`);

if (found.length > 0) process.exit(1);

process.stdout.write(
  `every table named in the ${String(files.length)} source files read is owned or declared, and every declared read is made\n`,
);
