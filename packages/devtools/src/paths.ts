import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const TEST_DIRECTORIES: ReadonlySet<string> = new Set(["e2e", "test", "tests"]);

const TEST_FILE = /(^test_|[._](test|spec)\.)/;

const NEVER_WALKED: ReadonlySet<string> = new Set([
  ".git",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "lifts",
  "node_modules",
  "playwright-report",
  "reports",
  "test-results",
]);

/** Pruned as it descends, because a package tree links to itself and a full walk never ends. */
const filesUnder = (root: string, directory: string): readonly string[] =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (NEVER_WALKED.has(entry.name)) return [];
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(root, relative);
    return entry.isFile() ? [relative] : [];
  });

/** Each file under the `roots` directories, relative to `root`, once and sorted. */
export const filesUnderEach = (root: string, roots: readonly string[]): readonly string[] =>
  [...new Set(roots.flatMap((directory) => filesUnder(root, directory)))].sort(byCodeUnit);

export const isTestPath = (file: string): boolean => {
  const segments = file.split("/");
  const name = segments.at(-1) ?? "";
  return segments.some((segment) => TEST_DIRECTORIES.has(segment)) || TEST_FILE.test(name);
};

const PACKAGES_BLOCK = /^packages:\n((?:[ \t]*-[ \t]+\S+[ \t]*\n)+)/m;

/** The workspace directories pnpm-workspace.yaml names, relative to the root and sorted. */
export const workspacePackages = (): readonly string[] => {
  const file = readFileSync(path.join(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  const block = PACKAGES_BLOCK.exec(file)?.[1];
  if (block === undefined) throw new Error("pnpm-workspace.yaml has no `packages:` list");

  const patterns = block
    .split("\n")
    .map((line) =>
      line
        .replace(/^[ \t]*-[ \t]+/, "")
        .trim()
        .replace(/^["']|["']$/g, ""),
    )
    .filter((entry) => entry.length > 0);

  const expand = (pattern: string): readonly string[] => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(path.join(repositoryRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  };

  return patterns
    .flatMap(expand)
    .filter((project) => existsSync(path.join(repositoryRoot, project, "package.json")))
    .sort(byCodeUnit);
};
