import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const packageRoot = (name: string): string => path.dirname(require.resolve(`${name}/package.json`));

const strykerRoot = packageRoot("@stryker-mutator/core");
const runnerRoot = packageRoot("@stryker-mutator/vitest-runner");

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

  // SAFETY: a report of another shape fails the assertions below rather than passing them.
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

      expect(rowAt(rows, 3, "BlockStatement", "{}")).toMatchObject({
        status: "Killed",
        testsCompleted: 1,
        statusReason: expect.stringContaining("undefined"),
      });

      expect(rowAt(rows, 4, "ConditionalExpression", "false")).toMatchObject({
        status: "Survived",
        testsCompleted: 1,
      });

      expect(rowAt(rows, 8, "StringLiteral", '""')).toMatchObject({
        status: "Killed",
        testsCompleted: 1,
        statusReason: expect.stringContaining("is not a family"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
