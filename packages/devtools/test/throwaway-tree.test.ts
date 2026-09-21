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

describe("a tool that cannot run is never mistaken for a tool that found nothing", () => {
  it("refuses a tool whose package is not in this package's dependency tree", () => {
    expect(() =>
      runsOverThrowawayTree(
        oxlintTool({ executable: { package: "no-such-linter", path: ["bin", "no-such-linter"] } }),
      ),
    ).toThrow(/no-such-linter/);
  });

  it("refuses a tool whose package is installed but carries no such executable", () => {
    expect(() =>
      runsOverThrowawayTree(
        oxlintTool({ executable: { package: "oxlint", path: ["bin", "absent"] } }),
      ),
    ).toThrow(/absent/);
  });

  it("refuses a configuration the tool could not parse, rather than reading its silence as a quiet rule", () => {
    expect(() =>
      runsOverThrowawayTree(oxlintTool({ scaffold: { ".oxlintrc.json": "{ not json" } })),
    ).toThrow(/oxlint/);
  });

  it("re-throws an exit the tool was not told to tolerate, carrying what the tool wrote", () => {
    expect(() => runsOverThrowawayTree(oxlintTool({ foundSomething: [] }))).toThrow(
      /exit 1[\s\S]*filename-case/,
    );
  });
});

describe("a tool that ran hands back what it reported", () => {
  it("returns the report on the exit that means the tool found something", () => {
    const lint = runsOverThrowawayTree(oxlintTool());

    expect(lint({ [CAMEL_CASE_FILE]: SOURCE })).toContain(CAMEL_CASE_FILE);
  });

  it("returns nothing when the tool ran over a tree it has nothing to say about", () => {
    const lint = runsOverThrowawayTree(oxlintTool());

    expect(lint({ [KEBAB_CASE_FILE]: SOURCE })).toBe("");
  });

  it("writes each tree fresh, so one run never sees the file another wrote", () => {
    const lint = runsOverThrowawayTree(oxlintTool());
    lint({ [CAMEL_CASE_FILE]: SOURCE });

    expect(lint({ [KEBAB_CASE_FILE]: SOURCE })).toBe("");
  });

  it("runs the tool in the environment the caller named, which is how a child finds a binary the tree has no node_modules for", () => {
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

  it("writes a file into a directory the tree names but does not create", () => {
    const lint = runsOverThrowawayTree(oxlintTool());

    expect(lint({ [`src/deep/${CAMEL_CASE_FILE}`]: SOURCE })).toContain(CAMEL_CASE_FILE);
  });
});

describe("oxlint over a config, for the suites that run this repository's lint rules", () => {
  const lint = oxlintOver(kebabCaseConfig, {
    tree: smokeTree,
    flagged: [CAMEL_CASE_FILE],
  });

  it("names the files a rule fired on and leaves out the ones it stayed silent about", () => {
    expect(lint.flagged({ [CAMEL_CASE_FILE]: SOURCE, [KEBAB_CASE_FILE]: SOURCE })).toEqual([
      CAMEL_CASE_FILE,
    ]);
  });

  it("hands back the whole report for a suite that reads the rule's name out of it", () => {
    expect(lint.output({ [CAMEL_CASE_FILE]: SOURCE })).toContain("filename-case");
  });

  it("refuses a smoke case the reporter does not answer the way the caller said it would", () => {
    expect(() =>
      oxlintOver(kebabCaseConfig, { tree: smokeTree, flagged: [KEBAB_CASE_FILE] }),
    ).toThrow(/smoke/i);
  });
});
