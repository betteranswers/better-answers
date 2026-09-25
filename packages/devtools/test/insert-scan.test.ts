import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  FACTORY_MODULES,
  isFactoryModule,
  isScanned,
  isSuiteFile,
  rawInsertsIn,
  SCAN_EXECUTABLE,
  WHERE_THE_LIST_LIVES,
} from "@better-answers/devtools/insert-scan";
import { repositoryRoot } from "@better-answers/devtools/oxlint-config";
import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

import { tag } from "./fixture-text.ts";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const WORKSPACE = "packages/probe";

/** Spelled in two halves, so the scan does not read this suite's own fixtures as violations. */
const insert = (table: string): string => `INSERT ${"INTO"} ${table} (id) VALUES (1)`;

const typescriptTest = `it("keeps a row", async () => {\n  await q(\`${insert("workspace")}\`);\n});\n`;

const pythonTest = `def test_keeps_a_row(cur: object) -> None:\n    cur.execute("${insert("workspace")}")\n`;

const PYTHON_WORKSPACE = "apps/probe";

const CLEAN: Tree = {
  [`${WORKSPACE}/test/one.test.ts`]: 'it("keeps a row", () => {});\n',
  [`${PYTHON_WORKSPACE}/tests/test_one.py`]: "def test_keeps_a_row() -> None:\n    pass\n",
};

const withTypescriptInsert = (): Tree => ({
  ...CLEAN,
  [`${WORKSPACE}/test/one.test.ts`]: typescriptTest,
});

const withPythonInsert = (): Tree => ({
  ...CLEAN,
  [`${PYTHON_WORKSPACE}/tests/test_one.py`]: pythonTest,
});

const scan = runsOverThrowawayTree({
  executable: SCAN_EXECUTABLE,
  argv: ["apps", "packages"],
  foundSomething: [1],
  smoke: {
    tree: withTypescriptInsert(),
    reports: (output) => output.includes(`${WORKSPACE}/test/one.test.ts:2:`),
  },
});

const findings = (tree: Tree): readonly string[] =>
  scan(tree)
    .split("\n")
    .filter((line) => line !== "");

describe("the territory the scan reads", () => {
  it.each([
    ["packages/core/test/workspaces.test.ts", true],
    ["apps/web/e2e/screen.spec.ts", true],
    ["apps/worker/tests/test_work_loop.py", true],
    ["packages/core/test/platform.ts", true],
    ["apps/worker/tests/factories.py", true],
    ["packages/core/src/workspaces/index.ts", false],
    ["apps/worker/tests/fixtures/rows.sql", false],
  ])("reads %s as a suite file: %s", (file, expected) => {
    expect(isSuiteFile(file)).toBe(expected);
  });

  it("scans a module beside a suite, which is no factory", () => {
    expect(isSuiteFile("packages/core/test/helpers.ts")).toBe(true);
    expect(isFactoryModule("packages/core/test/helpers.ts")).toBe(false);
    expect(isScanned("packages/core/test/helpers.ts")).toBe(true);
  });

  it("lets only a named module hold one", () => {
    expect(isFactoryModule("packages/schema/test/probes.ts")).toBe(true);
    expect(isScanned("packages/schema/test/probes.ts")).toBe(false);
  });

  it.each([
    ["a lower-case statement", `await q("${insert("job").toLowerCase()}")`],
    ["a statement split across columns", `\`${insert("job").slice(0, 20)}\n  , name)\``],
    ["a long literal's line", `const q = \`\n       ${insert("job")}\`;`],
    ["a quoted table name", `cur.execute('INSERT ${"INTO"} "index".chunk (id) VALUES (1)')`],
  ])("reads %s as a raw insert", (_what, source) => {
    expect(rawInsertsIn("one.test.ts", source)).toHaveLength(1);
  });

  it.each([
    ["a regex that names the statement", `expect(cause).toThrow(/INSERT ${"INTO"} job/);`],
    ["prose that names it", `// a raw INSERT ${"INTO"} belongs in a factory, never here`],
    ["a Python comment naming it", `    # INSERT ${"INTO"} job is what this must not carry`],
    ["a list insert, which names no table", "sys.meta_path.insert(0, Watch())"],
  ])("walks past %s", (_what, source) => {
    expect(rawInsertsIn("one.test.ts", source)).toEqual([]);
  });
});

describe("the named list of factory modules", () => {
  const holding = (file: string): readonly unknown[] => {
    const found = path.join(repositoryRoot, file);
    return existsSync(found) ? rawInsertsIn(file, readFileSync(found, "utf8")) : [];
  };

  it("names only files the tree has", () => {
    expect(FACTORY_MODULES.filter((file) => !existsSync(path.join(repositoryRoot, file)))).toEqual(
      [],
    );
  });

  it("names only files that carry a raw insert", () => {
    expect(FACTORY_MODULES.filter((file) => holding(file).length === 0)).toEqual([]);
  });

  it("lives where the failure message says it does", () => {
    expect(existsSync(path.join(repositoryRoot, WHERE_THE_LIST_LIVES))).toBe(true);
  });
});

describe("the scan over a throwaway tree", () => {
  it("fails on a TypeScript raw insert, naming line and rule", () => {
    const output = scan(withTypescriptInsert());

    expect(output).toContain(`${WORKSPACE}/test/one.test.ts:2:`);
    expect(output).toContain(tag("TEST", "4"));
  });

  it("names where the list of factory modules lives", () => {
    expect(scan(withTypescriptInsert())).toContain(WHERE_THE_LIST_LIVES);
  });

  it("fails on a Python test carrying a raw insert", () => {
    expect(findings(withPythonInsert())).toEqual([
      expect.stringContaining(`${PYTHON_WORKSPACE}/tests/test_one.py:2:`),
    ]);
  });

  it("fails on an unnamed module beside the suite", () => {
    const tree = {
      ...CLEAN,
      [`${WORKSPACE}/test/rows.ts`]: `const q = \`${insert("workspace")}\`;\n`,
    };

    expect(findings(tree)).toEqual([expect.stringContaining(`${WORKSPACE}/test/rows.ts:1:`)]);
  });

  it("passes over a named factory module that carries one", () => {
    const tree = {
      ...CLEAN,
      ["packages/schema/test/probes.ts"]: `const q = \`${insert("workspace")}\`;\n`,
    };

    expect(scan(tree)).toContain("no raw insert");
  });

  it("passes over a named Python factory module that carries one", () => {
    const tree = {
      ...CLEAN,
      ["apps/worker/tests/factories.py"]: `Q = "${insert("workspace")}"\n`,
    };

    expect(scan(tree)).toContain("no raw insert");
  });

  it.each([
    ["a regex naming the statement", `expect(cause).toThrow(/INSERT ${"INTO"} job/);\n`],
    ["prose that names it", `// a raw INSERT ${"INTO"} belongs in a factory, never here\n`],
  ])("passes over a test carrying %s", (_what, line) => {
    const tree = { ...CLEAN, [`${WORKSPACE}/test/one.test.ts`]: line };

    expect(scan(tree)).toContain("no raw insert");
  });

  it("walks past production code, which is where a statement belongs", () => {
    const tree = {
      ...CLEAN,
      [`${WORKSPACE}/src/workspaces.ts`]: `const q = \`${insert("workspace")}\`;\n`,
    };

    expect(scan(tree)).toContain("no raw insert");
  });

  it("refuses a run that read no suite file", () => {
    const noSuite = {
      [`${WORKSPACE}/src/one.ts`]: "export const one = 1;\n",
      [`${PYTHON_WORKSPACE}/src/one.py`]: "ONE = 1\n",
    };

    expect(() => scan(noSuite)).toThrow(/no suite file under/);
  });
});
