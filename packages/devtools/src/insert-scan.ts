import { filesUnderEach, isTestPath } from "./paths.ts";

const RAW_INSERT = /(?:^|["'`])\s*insert\s+into\s+["'`]?[a-z_]/i;

const SCANNED = /\.(?:tsx?|py)$/;

export const WHERE_THE_LIST_LIVES = "packages/devtools/src/insert-scan.ts";

export const FACTORY_MODULES = [
  "apps/worker/tests/factories.py",
  "apps/worker/tests/pg_harness.py",
  "packages/core/test/audit-rows.ts",
  "packages/core/test/identity-rows.ts",
  "packages/schema/test/before-the-action.ts",
  "packages/schema/test/before-the-knowledge-words.ts",
  "packages/schema/test/catalogue-statements.ts",
  "packages/schema/test/probes.ts",
  "packages/schema/test/rls-probes.ts",
];

export const SCAN_EXECUTABLE = {
  package: "@better-answers/devtools",
  path: ["..", "..", "scripts", "insert-scan.mjs"],
} as const;

export const isSuiteFile = (file: string): boolean => SCANNED.test(file) && isTestPath(file);

export const isFactoryModule = (file: string): boolean => FACTORY_MODULES.includes(file);

export const isScanned = (file: string): boolean => isSuiteFile(file) && !isFactoryModule(file);

export const scannedFilesUnder = (root: string, roots: readonly string[]): readonly string[] =>
  filesUnderEach(root, roots).filter(isScanned);

export type RawInsert = { readonly file: string; readonly line: number };

export const rawInsertsIn = (file: string, source: string): readonly RawInsert[] =>
  source
    .split("\n")
    .flatMap((text, index) => (RAW_INSERT.test(text) ? [{ file, line: index + 1 }] : []));

export const reportOf = (found: RawInsert): string =>
  `${found.file}:${String(found.line)}: a raw \`INSERT\` outside a factory module; move it into one of the modules ${WHERE_THE_LIST_LIVES} names.`;
