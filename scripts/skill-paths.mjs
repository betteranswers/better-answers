#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

const trackedFilesHere = execFileSync("git", ["-C", workingTree, "ls-files", "-z", SKILLS_FOLDER], {
  encoding: "utf8",
})
  .split("\0")
  .filter((file) => file !== "");

const tracked = new Set(trackedFilesHere.map((file) => file.split("/")[2]));

const linkTracked = new Set(
  trackedFilesHere.filter((file) => file.split("/").length === 3).map((file) => file.split("/")[2]),
);

const textOf = (skill) => {
  try {
    return readFileSync(skillFile(skill), "utf8");
  } catch {
    return null;
  }
};

const read = () => {
  const entries = readdirSync(path.join(workingTree, SKILLS_FOLDER), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name);
  return [...new Set([...entries, ...tracked])].map((skill) => ({
    skill,
    tracked: tracked.has(skill),
    symlink:
      lstatSync(path.join(workingTree, SKILLS_FOLDER, skill), {
        throwIfNoEntry: false,
      })?.isSymbolicLink() ?? false,
    linkTracked: linkTracked.has(skill),
    text: textOf(skill),
  }));
};

if (write) {
  const table = new Map(SCOPES.map((one) => [one.skill, one.paths]));
  for (const one of read()) {
    const paths = table.get(one.skill);
    if (paths === undefined || one.text === null || (one.symlink && !one.linkTracked)) continue;
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
