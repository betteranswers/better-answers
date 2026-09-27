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

/**
 * Models CI's contention: a slow sibling sleeps only while a mutant runs, so a whole-suite run
 * outlasts the short dry run's timeout budget.
 */
const CONTENDED_WORKSPACE = {
  "stryker.config.mjs": `export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/family.ts:8-8", "src/family.ts:15-15", "src/registry.ts:1-1", "src/pool.ts:2-2"],
  coverageAnalysis: "perTest",
  reporters: ["json"],
  jsonReporter: { fileName: "reports/mutation.json" },
  tempDirName: ".stryker-tmp",
  concurrency: 1,
};
`,
  // Pinned so the failing file runs first: a cancel saves only the files after it, so an earlier
  // slow sibling still times out.
  "vitest.config.mjs": `export default {
  test: {
    sequence: {
      sequencer: class {
        async shard(files) { return files; }
        async sort(files) { return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId)); }
      },
    },
  },
};
`,
  "src/family.ts": `${SOURCE}
export const describeFamily = (family: string): string => {
  if (isFamily(family)) return \`\${family} is a family\`;
  return "a stranger";
};
`,
  "src/registry.ts": `const ENTRIES: ReadonlyMap<string, number> = new Map([["knowledge", 1]]);

export const lookup = (name: string): number => {
  const found = ENTRIES.get(name);
  if (found === undefined) throw new Error(\`\${name} is not registered\`);
  return found;
};
`,
  "src/pool.ts": `export const release = (open: number): number => {
  if (open !== 0) throw new Error(\`\${String(open)} still open\`);
  return open;
};
`,
  "test/pool.test.ts": `import { afterAll, expect, it } from "vitest";

import { release } from "../src/pool.ts";

afterAll(() => {
  release(0);
});

it("opens nothing", () => {
  expect(0).toBe(0);
});
`,
  "test/family.test.ts": `import { describe, expect, it } from "vitest";

import { ACTS, describeFamily } from "../src/family.ts";

describe("a family", () => {
  it("declares the family", () => {
    expect(ACTS).toBe("knowledge");
  });

  it("describes a family", () => {
    expect(describeFamily("knowledge")).toBe("knowledge is a family");
  });
});
`,
  "test/registry.test.ts": `import { beforeAll, expect, it } from "vitest";

import { lookup } from "../src/registry.ts";

let entry = 0;

beforeAll(() => {
  entry = lookup("knowledge");
});

it("finds the entry", () => {
  expect(entry).toBe(1);
});
`,
  "test/slow-family.test.ts": `import { beforeAll, expect, it } from "vitest";

import { contended } from "./contended.ts";

beforeAll(contended, 60_000);

it("tells a stranger from a family", async () => {
  const { isFamily } = await import("../src/family.ts");
  expect(isFamily("stranger")).toBe(false);
});
`,
  "test/slow-registry.test.ts": `import { beforeAll, expect, it } from "vitest";

import { lookup } from "../src/registry.ts";
import { contended } from "./contended.ts";

beforeAll(contended, 60_000);

it("refuses a stranger", () => {
  expect(() => lookup("stranger")).toThrow("stranger is not registered");
});
`,
  "test/contended.ts": `export const contended = async (): Promise<void> => {
  const stryker = (globalThis as { __stryker__?: { activeMutant?: string } }).__stryker__;
  if (stryker?.activeMutant === undefined) return;
  await new Promise((resolve) => setTimeout(resolve, 30_000));
};
`,
};

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

const mutantsOfStrykerOver = (files: Readonly<Record<string, string>>): readonly Row[] => {
  const root = strykerWorkspace(mkdtempSync(path.join(tmpdir(), "vitest-runner-patch-")), files);
  try {
    runStryker(root);
    const parsed = mutationReport.parse(
      JSON.parse(readFileSync(path.join(root, "reports/mutation.json"), "utf8")),
    );
    return Object.values(parsed.files).flatMap((file) => file.mutants);
  } finally {
    // A forked stryker worker outliving the CLI leaves an entry here, and rmSync retries
    // ENOTEMPTY only when given both maxRetries and retryDelay.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
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
    const rows = mutantsOfStrykerOver({
      "stryker.config.mjs": STRYKER_CONFIG,
      "src/family.ts": SOURCE,
      "test/family.test.ts": SUITE,
    });

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
  });

  it("kills at once a mutant whose file or hook fails", () => {
    const rows = mutantsOfStrykerOver(CONTENDED_WORKSPACE);
    const importFails = rowAt(rows, 8, "StringLiteral", '""');
    const beforeAllThrows = rowAt(rows, 1, "StringLiteral", '""');
    const afterAllThrows = rowAt(rows, 2, "ConditionalExpression", "true");

    expect({
      importFails: importFails.status,
      beforeAllThrows: beforeAllThrows.status,
      afterAllThrows: afterAllThrows.status,
      staticSurvivor: rowAt(rows, 2, "ConditionalExpression", "false").status,
      survivor: rowAt(rows, 15, "ConditionalExpression", "true").status,
      killed: rowAt(rows, 15, "ConditionalExpression", "false").status,
    }).toEqual({
      importFails: "Killed",
      beforeAllThrows: "Killed",
      afterAllThrows: "Killed",
      staticSurvivor: "Survived",
      survivor: "Survived",
      killed: "Killed",
    });
    expect(importFails.statusReason).toBe("test/family.test.ts failed to load:  is not a family");
    expect(beforeAllThrows.statusReason).toBe(
      "the beforeAll of test/registry.test.ts failed: knowledge is not registered",
    );
    expect(afterAllThrows.statusReason).toBe(
      "the afterAll of test/pool.test.ts failed: 0 still open",
    );
  });
});
