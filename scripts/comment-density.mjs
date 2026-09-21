#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  countOver,
  measure,
  overTheCeiling,
  reportOf,
} from "../packages/devtools/src/comment-density.ts";

// The tree it is run in, not the tree it lives in, so a suite can spawn it over a throwaway.
const root = process.cwd();
const roots = process.argv.slice(2);

if (roots.length === 0) {
  process.stderr.write("comment-density: name at least one directory of workspaces\n");
  process.exit(2);
}

// A workspace is what carries a manifest, so a new one is measured without a line here.
const workspaces = roots.flatMap((directory) =>
  readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${directory}/${entry.name}`)
    .filter((workspace) =>
      ["package.json", "pyproject.toml"].some((manifest) =>
        existsSync(path.join(root, workspace, manifest)),
      ),
    ),
);

if (workspaces.length === 0) {
  process.stderr.write(`comment-density: no workspace under ${roots.join(", ")}\n`);
  process.exit(2);
}

let counted;
try {
  counted = countOver(root, workspaces);
} catch (cause) {
  process.stderr.write(`comment-density: the line counter did not run: ${String(cause)}\n`);
  process.exit(2);
}

// A counter that read nothing is a gate that proved nothing, never a tree under the ceiling.
if (counted.length === 0) {
  process.stderr.write("comment-density: the line counter measured no file it understands\n");
  process.exit(2);
}

const over = overTheCeiling(measure(counted, workspaces));

for (const one of over) process.stdout.write(`${reportOf(one)}\n`);

if (over.length > 0) process.exit(1);

process.stdout.write(
  `comment density is under the ceiling in all ${workspaces.length} workspaces\n`,
);
