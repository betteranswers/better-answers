import { readdirSync } from "node:fs";
import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

/** A statement, not the two words: it opens a string literal, or a line inside a long one. */
const RAW_INSERT = /(?:^|["'`])\s*insert\s+into\s+["'`]?[a-z_]/i;

const TEST_FILE = /(^test_|[._](test|spec)\.)/;

const SCANNED = /\.(?:tsx?|py)$/;

const SUITE_DIRECTORIES = new Set(["e2e", "test", "tests"]);

const NEVER_WALKED = new Set([
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

export const WHERE_THE_LIST_LIVES = "packages/devtools/src/insert-scan.ts";

/** A file cannot become a factory by being written beside a suite, so each one is named here. */
export const FACTORY_MODULES = [
  "apps/worker/tests/factories.py",
  "apps/worker/tests/pg_harness.py",
  "packages/core/test/identity-rows.ts",
  "packages/schema/test/catalogue-statements.ts",
  "packages/schema/test/probes.ts",
  "packages/schema/test/rls-probes.ts",
];

export const SCAN_EXECUTABLE = {
  package: "@better-answers/devtools",
  path: ["..", "..", "scripts", "insert-scan.mjs"],
} as const;

/** The suites' territory: a test by its name, and every module that sits among them. */
export const isSuiteFile = (file: string): boolean => {
  const segments = file.split("/");
  const name = segments.at(-1) ?? "";
  if (!SCANNED.test(name)) return false;
  return segments.some((segment) => SUITE_DIRECTORIES.has(segment)) || TEST_FILE.test(name);
};

export const isFactoryModule = (file: string): boolean => FACTORY_MODULES.includes(file);

export const isScanned = (file: string): boolean => isSuiteFile(file) && !isFactoryModule(file);

/** Pruned as it descends, because a package tree links to itself and a full walk never ends. */
const filesUnder = (root: string, directory: string): readonly string[] =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (NEVER_WALKED.has(entry.name)) return [];
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(root, relative);
    return entry.isFile() ? [relative] : [];
  });

/** Each scanned file under the `roots` directories, relative to `root`, once and sorted. */
export const scannedFilesUnder = (root: string, roots: readonly string[]): readonly string[] =>
  [...new Set(roots.flatMap((directory) => filesUnder(root, directory)))]
    .filter(isScanned)
    .sort(byCodeUnit);

export type RawInsert = { readonly file: string; readonly line: number };

/** `file` only labels each finding; `line` counts from 1. */
export const rawInsertsIn = (file: string, source: string): readonly RawInsert[] =>
  source
    .split("\n")
    .flatMap((text, index) => (RAW_INSERT.test(text) ? [{ file, line: index + 1 }] : []));

const RULE = "[TEST4]";

export const reportOf = (found: RawInsert): string =>
  `${found.file}:${String(found.line)}: a raw \`INSERT\` outside a factory module; move it into one of the modules ${WHERE_THE_LIST_LIVES} names (${RULE}).`;
