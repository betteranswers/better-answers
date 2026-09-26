import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { executableOf, writeUnder } from "@better-answers/devtools/throwaway-tree";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const OXLINT = { package: "oxlint", path: ["bin", "oxlint"] } as const;

/** Spawned, not run through the runner, which reports and never rewrites; a finding left unfixed exits 1. */
export const fixedByOxlint = (configJson: string, tree: Tree, file: string, exit = 0): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "oxlint-fix-"));
  writeUnder(directory, ".oxlintrc.json", configJson);
  for (const [name, source] of Object.entries(tree)) writeUnder(directory, name, source);
  const run = spawnSync(executableOf(OXLINT), ["--config", ".oxlintrc.json", "--fix", "."], {
    cwd: directory,
    encoding: "utf8",
  });
  if (run.status !== exit) {
    throw new Error(
      `oxlint --fix exited ${String(run.status)}, not ${String(exit)}: ${run.stdout}`,
    );
  }
  return readFileSync(path.join(directory, file), "utf8");
};
