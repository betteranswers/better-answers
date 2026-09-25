import { describe, expect, it } from "vitest";

import { oxlintOver, runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
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
