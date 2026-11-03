#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { trackedFiles } from "../packages/devtools/src/paths.ts";
import {
  findingsFor,
  SCOPES,
  SKILLS_FOLDER,
  withPaths,
} from "../packages/devtools/src/scans/skill-paths.ts";

const workingTree = process.cwd();

if (process.argv.slice(2).some((flag) => flag !== "--write")) {
  process.stderr.write("usage: skill-paths [--write]\n");
  process.exit(2);
}

const write = process.argv.includes("--write");

const skillFile = (skill) => path.join(workingTree, SKILLS_FOLDER, skill, "SKILL.md");

const tracked = new Set(
  trackedFiles(workingTree)
    .filter((file) => file.startsWith(`${SKILLS_FOLDER}/`))
    .map((file) => file.split("/")[2]),
);

const read = () =>
  readdirSync(path.join(workingTree, SKILLS_FOLDER), { withFileTypes: true }).flatMap((entry) => {
    try {
      return [
        {
          skill: entry.name,
          tracked: tracked.has(entry.name),
          text: readFileSync(skillFile(entry.name), "utf8"),
        },
      ];
    } catch {
      return [];
    }
  });

if (write) {
  const table = new Map(SCOPES.map((one) => [one.skill, one.paths]));
  for (const one of read()) {
    const paths = table.get(one.skill);
    if (paths === undefined) continue;
    const next = withPaths(one.text, paths);
    if (next === one.text) continue;
    writeFileSync(skillFile(one.skill), next);
    process.stdout.write(`skill-paths: wrote ${one.skill}\n`);
  }
}

const found = findingsFor(read());

for (const one of found) process.stdout.write(`${one}\n`);

if (found.length > 0) process.exit(1);

process.stdout.write(
  "every skill under .claude/skills holds exactly the paths its table row names\n",
);
