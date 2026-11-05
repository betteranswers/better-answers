#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  countOver,
  measure,
  overTheCeiling,
  reportOf,
} from "../packages/devtools/src/comments/comment-density.ts";

/** The working directory, not this file's tree, so a test can run it over a throwaway tree. */
const root = process.cwd();

const refuse = (message) => {
  process.stderr.write(`comment-density: ${message}\n`);
  process.exit(2);
};

let parsed;
try {
  parsed = parseArgs({ args: process.argv.slice(2), allowPositionals: true });
} catch (cause) {
  refuse(String(cause instanceof Error ? cause.message : cause));
}

const roots = parsed.positionals;
if (roots.length === 0) {
  refuse("name at least one root of workspaces, for example: comment-density apps packages");
}

/** Any folder with a manifest is a workspace, so a new workspace is measured without a change here. */
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
  refuse(`no workspace under ${roots.join(", ")}`);
}

let counted;
try {
  counted = countOver(root, workspaces);
} catch (cause) {
  refuse(`the line counter did not run: ${String(cause)}`);
}

// If the counter read no file, the gate proved nothing, so refuse instead of passing.
if (counted.length === 0) {
  refuse("the line counter measured no file it understands");
}

const measured = measure(counted, workspaces);

const over = overTheCeiling(measured);

for (const one of over) process.stdout.write(`${reportOf(one)}\n`);

if (over.length > 0) process.exit(1);

const plural = (howMany, one, many) => `${howMany} ${howMany === 1 ? one : many}`;

const tally = plural(workspaces.length, "workspace", "workspaces");

process.stdout.write(`comment density is under the ceiling in all ${tally}\n`);
