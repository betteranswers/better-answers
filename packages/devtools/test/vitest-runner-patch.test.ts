import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runStryker, strykerWorkspace } from "./stryker-workspace.ts";

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

const workspace = (): string =>
  strykerWorkspace(mkdtempSync(path.join(tmpdir(), "vitest-runner-patch-")), {
    "stryker.config.mjs": STRYKER_CONFIG,
    "src/family.ts": SOURCE,
    "test/family.test.ts": SUITE,
  });

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

describe("the vitest runner's patch over a throwaway workspace", () => {
  it("kills load-time and nested-only mutants, and keeps a survivor", () => {
    const root = workspace();
    try {
      runStryker(root);
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
