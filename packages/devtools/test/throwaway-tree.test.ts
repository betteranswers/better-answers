import { describe, expect, it } from "vitest";

import { oxlintOver, runsOverThrowawayTree } from "../src/throwaway-tree.ts";
import type { Tool, Tree } from "../src/throwaway-tree.ts";

/**
 * The runner every gate's functional test runs its tool through (`[CHECK1]`).
 *
 * It is what stands between "the rule stayed silent" and "the tool never ran", so
 * this suite is mostly about the second reading being impossible. Three lint-rule suites
 * used to swallow a non-zero exit into an empty string; under that shape a missing binary, a
 * config the tool refused, or a plugin that failed to load turned every "it fires here"
 * assertion into a tautology that passed.
 *
 * oxlint is the tool under test because it is in this package's dependency tree and it
 * exercises the awkward case honestly: it exits 1 both for a diagnostic and for a
 * configuration it could not parse, and it writes the second to stdout. Exit codes alone
 * therefore cannot tell the two apart, which is why a smoke case is part of the interface
 * rather than advice.
 */

const oxlint: Tool["executable"] = { package: "oxlint", path: ["bin", "oxlint"] };

/** A file whose name oxlint's `unicorn/filename-case` rule refuses. */
const CAMEL_CASE_FILE = "routeTable.ts";
const KEBAB_CASE_FILE = "route-table.ts";
const SOURCE = "export const keep = 1;\n";

const kebabCaseConfig = JSON.stringify({
  plugins: ["unicorn"],
  rules: { "unicorn/filename-case": ["error", { case: "kebabCase" }] },
});

const smokeTree: Tree = { [CAMEL_CASE_FILE]: SOURCE };

/** oxlint's own "I found something" exit; anything else means it did not run. */
const FOUND_SOMETHING = [1];

const reportsAFileAndPosition = (output: string): boolean => /^[^\s:]+:\d+:\d+:/m.test(output);

const oxlintTool = (over: Partial<Tool> = {}): Tool => ({
  name: "oxlint",
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
    // The case exit codes cannot catch: oxlint answers a broken config with the same exit it
    // uses for a diagnostic, and says so on stdout. Only the smoke case tells them apart.
    expect(() =>
      runsOverThrowawayTree(oxlintTool({ scaffold: { ".oxlintrc.json": "{ not json" } })),
    ).toThrow(/oxlint/);
  });

  it("re-throws an exit the tool was not told to tolerate, carrying what the tool wrote", () => {
    // The smoke case is the runner's first call, so an exit the tool was not told to
    // tolerate is refused before a caller ever holds the runner.
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
