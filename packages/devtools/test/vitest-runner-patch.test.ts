import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

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

export const isFamily = (family: string): boolean => {
  return FAMILIES.includes(family);
};
`;

const SUITE = `import { describe, expect, it } from "vitest";

import { ACTS, isFamily } from "../src/family.ts";

describe("a family", () => {
  it("declares the family", () => {
    expect(ACTS).toBe("knowledge");
  });

  it("tells a family from a stranger", () => {
    expect(isFamily("knowledge")).toBe(true);
  });
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

const mutantRow = z.object({
  mutatorName: z.string(),
  replacement: z.string().optional(),
  status: z.string(),
  testsCompleted: z.number().optional(),
  statusReason: z.string().optional(),
  location: z.object({ start: z.object({ line: z.number() }) }),
});
type Row = z.infer<typeof mutantRow>;

const mutationReport = z.object({
  files: z.record(z.string(), z.object({ mutants: z.array(mutantRow) })),
});

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
  const parsed = mutationReport.parse(
    JSON.parse(readFileSync(path.join(root, "reports/mutation.json"), "utf8")),
  );
  return Object.values(parsed.files).flatMap((file) => file.mutants);
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
      `no ${mutatorName} → ${replacement} mutant on line ${String(line)}; the report holds:\n${rows.map((found) => `${String(found.location.start.line)} ${found.mutatorName} ${found.replacement ?? ""} ${found.status}`).join("\n")}`,
    );
  }
  return found;
};

describe("the vitest runner's patch, run over a throwaway workspace (T-107, T-372)", () => {
  it("kills a mutant that throws while its module loads, and one that only its test inside a describe reaches, beside a plain kill and a survivor", () => {
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
        testsCompleted: 2,
      });

      expect(rowAt(rows, 8, "StringLiteral", '""')).toMatchObject({
        status: "Killed",
        testsCompleted: 1,
        statusReason: expect.stringContaining("is not a family"),
      });

      // Reached only while a test runs, so its run is filtered to that test by its full name.
      expect(rowAt(rows, 10, "BlockStatement", "{}")).toMatchObject({
        status: "Killed",
        testsCompleted: 1,
      });
    } finally {
      // A forked stryker worker outliving the CLI leaves an entry here, and rmSync retries
      // ENOTEMPTY only when given both maxRetries and retryDelay.
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
