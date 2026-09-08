import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The patch under `patches/` on `@stryker-mutator/vitest-runner`, run rather than read
 * (`[CHECK1]`; T-107).
 *
 * A mutant that throws while its module loads fails every test file that imports it before
 * one test runs, and the unpatched runner reads a file with no test tasks as nothing run:
 * the mutant is reported survived with `testsCompleted: 0` — thirty-nine such rows in run
 * 34168928594, every one a survivor no test was ever run against. The patch reports the
 * file's failure to load as one failed test named for the file, so the mutant is killed
 * with the error it caused.
 *
 * Stryker is run over a throwaway workspace with one source file whose mutants take the
 * three shapes the report must tell apart: a plain kill (a test's assertion fails), a
 * survivor (no test reaches the difference — the negative control the triage method asks
 * for, so a run that kills everything cannot pass here), and the kill the patch makes (the
 * module refuses to load). Every expected row is written down (`[TEST9]`). A patch that
 * stopped applying — an upgrade of the runner drops it — reads as the third row surviving
 * with no test, which is the failure this file exists to catch.
 */

const require = createRequire(import.meta.url);
const packageRoot = (name: string): string => path.dirname(require.resolve(`${name}/package.json`));

const strykerRoot = packageRoot("@stryker-mutator/core");
const runnerRoot = packageRoot("@stryker-mutator/vitest-runner");
/** The vitest the runner itself loads, so the suite and the runner share one instance. */
const vitestRoot = path.dirname(
  createRequire(path.join(runnerRoot, "package.json")).resolve("vitest/package.json"),
);

const SOURCE = `const FAMILIES: readonly string[] = ["knowledge"];

export const declare = (family: string): string => {
  if (!FAMILIES.includes(family)) throw new Error(\`\${family} is not a family\`);
  return family;
};

export const ACTS = declare("knowledge");
`;

const SUITE = `import { expect, it } from "vitest";

import { ACTS } from "../src/family.ts";

it("declares the family", () => {
  expect(ACTS).toBe("knowledge");
});
`;

const STRYKER_CONFIG = `export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/**/*.ts"],
  coverageAnalysis: "perTest",
  reporters: ["json"],
  jsonReporter: { fileName: "reports/mutation.json" },
  tempDirName: ".stryker-tmp",
  concurrency: 1,
  timeoutMS: 30_000,
};
`;

type Row = {
  readonly mutatorName: string;
  readonly replacement: string;
  readonly status: string;
  readonly testsCompleted?: number;
  readonly statusReason?: string;
  readonly location: { readonly start: { readonly line: number } };
};

const workspace = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "vitest-runner-patch-"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "throwaway", private: true, type: "module" }),
  );
  writeFileSync(path.join(root, "stryker.config.mjs"), STRYKER_CONFIG);
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "test"));
  writeFileSync(path.join(root, "src/family.ts"), SOURCE);
  writeFileSync(path.join(root, "test/family.test.ts"), SUITE);
  mkdirSync(path.join(root, "node_modules/@stryker-mutator"), { recursive: true });
  symlinkSync(strykerRoot, path.join(root, "node_modules/@stryker-mutator/core"));
  symlinkSync(runnerRoot, path.join(root, "node_modules/@stryker-mutator/vitest-runner"));
  symlinkSync(vitestRoot, path.join(root, "node_modules/vitest"));
  return root;
};

const rowsOf = (root: string): readonly Row[] => {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(root, "reports/mutation.json"), "utf8"),
  );
  // SAFETY: Stryker's JSON reporter writes the mutation-testing report, whose one file here
  // is the source written above; the rows are read by mutator, replacement and line, and a
  // report of another shape fails the assertions below rather than passing them.
  const report = parsed as { readonly files: Record<string, { readonly mutants: readonly Row[] }> };
  return Object.values(report.files).flatMap((file) => file.mutants);
};

const rowAt = (
  rows: readonly Row[],
  line: number,
  mutatorName: string,
  replacement: string,
): Row => {
  const found = rows.find(
    (row) =>
      row.location.start.line === line &&
      row.mutatorName === mutatorName &&
      row.replacement === replacement,
  );
  if (found === undefined) {
    throw new Error(
      `no ${mutatorName} → ${replacement} mutant on line ${String(line)}; the report holds:\n${rows.map((row) => `${String(row.location.start.line)} ${row.mutatorName} ${row.replacement} ${row.status}`).join("\n")}`,
    );
  }
  return found;
};

describe("the vitest runner's patch, run over a throwaway workspace (T-107)", () => {
  it("kills a mutant that throws while its module loads, beside a plain kill and a survivor", () => {
    const root = workspace();
    try {
      const run = spawnSync(process.execPath, [path.join(strykerRoot, "bin/stryker.js"), "run"], {
        cwd: root,
        encoding: "utf8",
      });
      if (run.status !== 0) {
        throw new Error(`stryker exited ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
      }
      const rows = rowsOf(root);

      // A plain kill: the function's body emptied, so ACTS is undefined and the assertion fails.
      expect(rowAt(rows, 3, "BlockStatement", "{}")).toMatchObject({
        status: "Killed",
        testsCompleted: 1,
        statusReason: expect.stringContaining("undefined"),
      });
      // A survivor: the refusal never fires, and no test asks for a family that is refused.
      expect(rowAt(rows, 4, "ConditionalExpression", "false")).toMatchObject({
        status: "Survived",
        testsCompleted: 1,
      });
      // The patch's kill: the family emptied at the call the module makes while loading,
      // so the suite's one file fails before its test runs — read as a kill, with the
      // error the module threw, and not as no test run.
      expect(rowAt(rows, 8, "StringLiteral", '""')).toMatchObject({
        status: "Killed",
        testsCompleted: 1,
        statusReason: expect.stringContaining("is not a family"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
