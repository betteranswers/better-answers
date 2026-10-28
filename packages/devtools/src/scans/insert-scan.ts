import { filesUnderEach, isTestPath } from "../paths.ts";

const RAW_INSERT = /(?:^|["'`])\s*insert\s+into\s+["'`]?[a-z_]/iu;

const SCANNED = /\.(?:tsx?|py)$/u;

export const WHERE_THE_LIST_LIVES = "packages/devtools/src/scans/insert-scan.ts";

export const FACTORY_MODULES = [
  "apps/worker/tests/support/factories.py",
  "apps/worker/tests/support/pg_harness.py",
  "packages/core/test/members/audit-log/audit-rows.ts",
  "packages/core/test/support/identity-rows.ts",
  "packages/schema/test/knowledge/concept-index-rows.ts",
  "packages/schema/test/migrations/before-the-action.ts",
  "packages/schema/test/migrations/before-the-knowledge-words.ts",
  "packages/schema/test/migrations/catalogue-statements.ts",
  "packages/schema/test/support/probes.ts",
  "packages/schema/test/support/rls-probes.ts",
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
