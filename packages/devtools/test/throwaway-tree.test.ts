import { mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  oxlintOver,
  runsOverThrowawayTree,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";
import type { Tool, Tree } from "@better-answers/devtools/throwaway-tree";

const oxlint: Tool["executable"] = { package: "oxlint", path: ["bin", "oxlint"] };

const CAMEL_CASE_FILE = "routeTable.ts";
const KEBAB_CASE_FILE = "route-table.ts";
const SOURCE = "export const keep = 1;\n";

const kebabCaseConfig = JSON.stringify({
  plugins: ["unicorn"],
  rules: { "unicorn/filename-case": ["error", { case: "kebabCase" }] },
});

const smokeTree: Tree = { [CAMEL_CASE_FILE]: SOURCE };

const FOUND_SOMETHING = [1];

const MINUTE_MS = 60_000;

const reportsAFileAndPosition = (output: string): boolean => /^[^\s:]+:\d+:\d+:/m.test(output);

const oxlintTool = (over: Partial<Tool> = {}): Tool => ({
  executable: oxlint,
  argv: ["--config", ".oxlintrc.json", "--format=unix", "."],
  scaffold: { ".oxlintrc.json": kebabCaseConfig },
  foundSomething: FOUND_SOMETHING,
  smoke: { tree: smokeTree, reports: reportsAFileAndPosition },
  ...over,
});

describe("runsOverThrowawayTree over a tool that cannot run", () => {
  it("refuses a tool whose package is not a dependency", () => {
    expect(() =>
      runsOverThrowawayTree(
        oxlintTool({ executable: { package: "no-such-linter", path: ["bin", "no-such-linter"] } }),
      ),
    ).toThrow(/no-such-linter/);
  });

  it("refuses an installed package that carries no such executable", () => {
    expect(() =>
      runsOverThrowawayTree(
        oxlintTool({ executable: { package: "oxlint", path: ["bin", "absent"] } }),
      ),
    ).toThrow(/absent/);
  });

  it("refuses a configuration the tool could not parse", () => {
    expect(() =>
      runsOverThrowawayTree(oxlintTool({ scaffold: { ".oxlintrc.json": "{ not json" } })),
    ).toThrow(/oxlint/);
  });

  it("re-throws an untolerated exit, carrying what the tool wrote", () => {
    expect(() => runsOverThrowawayTree(oxlintTool({ foundSomething: [] }))).toThrow(
      /exit 1[\s\S]*filename-case/,
    );
  });

  it("refuses a time limit that reaches the sweep's hour", () => {
    expect(() => runsOverThrowawayTree(oxlintTool({ timeoutMs: 60 * MINUTE_MS }))).toThrow(
      /3600000 ms/,
    );
    expect(() => runsOverThrowawayTree(oxlintTool({ timeoutMs: 59 * MINUTE_MS }))).not.toThrow();
  });
});

describe("runsOverThrowawayTree over a tool that ran", () => {
  it("returns the report on an exit that means a finding", () => {
    const lint = runsOverThrowawayTree(oxlintTool());

    expect(lint({ [CAMEL_CASE_FILE]: SOURCE })).toContain(CAMEL_CASE_FILE);
  });

  it("returns nothing over a tree the tool finds nothing in", () => {
    const lint = runsOverThrowawayTree(oxlintTool());

    expect(lint({ [KEBAB_CASE_FILE]: SOURCE })).toBe("");
  });

  it("writes each tree fresh, so no run sees another's files", () => {
    const lint = runsOverThrowawayTree(oxlintTool());
    lint({ [CAMEL_CASE_FILE]: SOURCE });

    expect(lint({ [KEBAB_CASE_FILE]: SOURCE })).toBe("");
  });

  it("runs the tool in the environment the caller named", () => {
    expect(() =>
      runsOverThrowawayTree(
        oxlintTool({
          scaffold: {
            ".oxlintrc.json": JSON.stringify({
              plugins: ["typescript"],
              options: { typeAware: true },
              rules: { "typescript/no-floating-promises": "error" },
            }),
          },
          env: { OXLINT_TSGOLINT_PATH: "/nowhere/tsgolint" },
        }),
      ),
    ).toThrow(/\/nowhere\/tsgolint/);
  });

  it("creates the directories a file's path names", () => {
    const lint = runsOverThrowawayTree(oxlintTool());

    expect(lint({ [`src/deep/${CAMEL_CASE_FILE}`]: SOURCE })).toContain(CAMEL_CASE_FILE);
  });
});

describe("oxlintOver", () => {
  const lint = oxlintOver(kebabCaseConfig, {
    tree: smokeTree,
    flagged: [CAMEL_CASE_FILE],
  });

  it("names the files a rule fired on, and no others", () => {
    expect(lint.flagged({ [CAMEL_CASE_FILE]: SOURCE, [KEBAB_CASE_FILE]: SOURCE })).toEqual([
      CAMEL_CASE_FILE,
    ]);
  });

  it("hands back the whole report, rule names included", () => {
    expect(lint.output({ [CAMEL_CASE_FILE]: SOURCE })).toContain("filename-case");
  });

  it("refuses a smoke case the report does not match", () => {
    expect(() =>
      oxlintOver(kebabCaseConfig, { tree: smokeTree, flagged: [KEBAB_CASE_FILE] }),
    ).toThrow(/smoke/i);
  });
});

// Resolved because oxlint names a tree by its real path, and macOS's temp directory is a link.
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "throwaway-tree-test-")));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const TREES = "better-answers-throwaway-trees";

const ANOTHER_RUNS_TREE = "tree-another-run";

/** `os.tmpdir()` reads `TMPDIR` on every call, so the runner's folder moves into this one. */
const ownTemp = (): string => {
  const temp = mkdtempSync(path.join(scratch, "temp-"));
  vi.stubEnv("TMPDIR", temp);
  return temp;
};

const plantTree = (temp: string, name: string, ageMs = 0): void => {
  const tree = path.join(temp, TREES, name);
  writeUnder(tree, KEBAB_CASE_FILE, SOURCE);
  const modifiedSeconds = (Date.now() - ageMs) / 1000;
  utimesSync(tree, modifiedSeconds, modifiedSeconds);
};

const treesIn = (temp: string): readonly string[] => readdirSync(path.join(temp, TREES)).sort();

/** The last two end in the smoke run, which is a run like any other. */
const runEndings: readonly { readonly ending: string; readonly run: () => void }[] = [
  {
    ending: "a finding",
    run: () => {
      expect(runsOverThrowawayTree(oxlintTool())(smokeTree)).toContain(CAMEL_CASE_FILE);
    },
  },
  {
    ending: "a clean pass",
    run: () => {
      expect(runsOverThrowawayTree(oxlintTool())({ [KEBAB_CASE_FILE]: SOURCE })).toBe("");
    },
  },
  {
    ending: "a tool failure",
    run: () => {
      expect(() => runsOverThrowawayTree(oxlintTool({ foundSomething: [] }))).toThrow(/exit 1/);
    },
  },
  {
    ending: "a timeout",
    run: () => {
      expect(() => runsOverThrowawayTree(oxlintTool({ timeoutMs: 1 }))).toThrow(
        /stopped after 1 ms/,
      );
    },
  },
];

describe("runsOverThrowawayTree's trees", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs each tool in a tree under one temp folder", () => {
    const temp = ownTemp();

    expect(() =>
      runsOverThrowawayTree(oxlintTool({ scaffold: { ".oxlintrc.json": "{ not json" } })),
    ).toThrow(path.join(temp, TREES, "tree-"));
    expect(readdirSync(temp)).toEqual([TREES]);
  });

  it.each(runEndings)("removes only its own tree after $ending", ({ run }) => {
    const temp = ownTemp();
    plantTree(temp, ANOTHER_RUNS_TREE);
    expect(treesIn(temp)).toEqual([ANOTHER_RUNS_TREE]);

    run();

    expect(treesIn(temp)).toEqual([ANOTHER_RUNS_TREE]);
  });

  it("sweeps only trees over an hour old on first use", () => {
    const temp = ownTemp();
    plantTree(temp, "tree-61-minutes-old", 61 * MINUTE_MS);
    plantTree(temp, "tree-59-minutes-old", 59 * MINUTE_MS);

    runsOverThrowawayTree(oxlintTool());

    expect(treesIn(temp)).toEqual(["tree-59-minutes-old"]);
  });

  it("sweeps once a process, so later stale trees stay", () => {
    const temp = ownTemp();
    runsOverThrowawayTree(oxlintTool());
    plantTree(temp, "tree-61-minutes-old", 61 * MINUTE_MS);

    runsOverThrowawayTree(oxlintTool());

    expect(treesIn(temp)).toEqual(["tree-61-minutes-old"]);
  });
});
