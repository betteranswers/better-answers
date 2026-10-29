import { describe, expect, it } from "vitest";

import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import type { Tool, Tree } from "@better-answers/devtools/throwaway-tree";

const MODULE = "apps/worker/tests/pipeline/test_probe.py";

const TOOLING = "packages/devtools/python/probe.py";

const WORKER_HELPER =
  "`REPOSITORY_ROOT` or `WORKER_ROOT` from `support.roots` (apps/worker/tests/support/roots.py)";

const TOOLING_HELPER = "`REPOSITORY_ROOT` from `roots` (packages/devtools/python/roots.py)";

const reading = (code: string, file = MODULE): Tree => ({ [file]: `${code}\n` });

const SEEDED = reading('CONTRACTS = Path(__file__).resolve().parents[4] / "contracts"');

const scan: Tool = {
  executable: { package: "@better-answers/devtools", path: ["python", "climb_scan.py"] },
  argv: ["apps/worker/tests", "packages/devtools/python"],
  scaffold: { [TOOLING]: "VALUE = 1\n" },
  foundSomething: [1],
  smoke: { tree: SEEDED, reports: (output) => output.includes(`${MODULE}:1:`) },
};

const run = runsOverThrowawayTree(scan);

const findings = (tree: Tree): readonly string[] =>
  run(tree)
    .split("\n")
    .filter((line) => line !== "");

const climbs = (line: number, written: string, helper = WORKER_HELPER, file = MODULE): string =>
  `${file}:${String(line)}: \`${written}\` climbs above this file's folder, so the path breaks when the file moves. Import ${helper} and join the path from there.`;

const passed = (modules: number): string =>
  `climb_scan: no module climbs above its own folder (modules read: ${String(modules)})`;

const refusal = (message: string): RegExp =>
  new RegExp(`exit 2\\n\\nclimb_scan: ${message.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n$`);

describe("the climb scan over a throwaway tree", () => {
  it("refuses a seeded climb and names the helper", () => {
    expect(findings(SEEDED)).toEqual([climbs(1, "Path(__file__).resolve().parents[4]")]);
  });

  it("refuses a climb that stays in the workspace", () => {
    const code = 'FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"';

    expect(findings(reading(code))).toEqual([climbs(1, "Path(__file__).resolve().parents[1]")]);
  });

  it("refuses a chain of `.parent` as one climb", () => {
    const code = "ROOT = Path(__file__).resolve().parent.parent.parent";

    expect(findings(reading(code))).toEqual([
      climbs(1, "Path(__file__).resolve().parent.parent.parent"),
    ]);
  });

  it("refuses a `..` step", () => {
    const code = 'DEPLOY = Path(__file__).parent / ".." / "deploy"';

    expect(findings(reading(code))).toEqual([climbs(1, "Path(__file__).parent / '..'")]);
  });

  it("refuses a climb from a name that holds a root", () => {
    const code = "REPO = WORKER_ROOT.parents[1]";

    expect(findings(reading(code))).toEqual([climbs(1, "WORKER_ROOT.parents[1]")]);
  });

  it("reads the line a climb sits on", () => {
    const code = 'import os\n\nROOT = Path(__file__).parents[2] / "src"';

    expect(findings(reading(code))).toEqual([climbs(3, "Path(__file__).parents[2]")]);
  });

  it("names the helper of the devtools scripts", () => {
    const tree = reading('CASES = Path(__file__).resolve().parents[3] / "contracts"', TOOLING);

    expect(findings({ ...tree, [MODULE]: "VALUE = 1\n" })).toEqual([
      climbs(1, "Path(__file__).resolve().parents[3]", TOOLING_HELPER, TOOLING),
    ]);
  });
});

describe("the climb scan walks past a path that stays", () => {
  it.each([
    ["its own folder", 'HERE = Path(__file__).parent / "fixtures"'],
    ["a root from the helper", 'CONTRACTS = REPOSITORY_ROOT / "contracts"'],
    ["a search up for a marker", "FOUND = [d for d in Path(__file__).resolve().parents if d]"],
    ["a string that only reads like a climb", 'ESCAPES = ("../escape", "..", "a/../b")'],
  ])("over %s", (_what, code) => {
    expect(findings(reading(code))).toEqual([passed(2)]);
  });
});

describe("the climb scan refuses to prove nothing", () => {
  it("stops when no directory is named", () => {
    expect(() => runsOverThrowawayTree({ ...scan, argv: [] })).toThrow(
      refusal("name at least one directory to read"),
    );
  });

  it("stops when a named directory is missing", () => {
    expect(() => runsOverThrowawayTree({ ...scan, argv: ["apps/worker/absent"] })).toThrow(
      refusal("no directory at apps/worker/absent"),
    );
  });

  it("stops when the walk reads no Python file", () => {
    const folder = "apps/worker/tests/pipeline/none";
    const notes = { ...SEEDED, [`${folder}/notes.txt`]: "x\n" };

    expect(() =>
      runsOverThrowawayTree({ ...scan, argv: [folder], smoke: { ...scan.smoke, tree: notes } }),
    ).toThrow(refusal(`no Python file under ${folder}`));
  });

  it("stops at a module that does not parse", () => {
    expect(() => run(reading("def broken(:"))).toThrow(
      new RegExp(`exit 2\\n\\nclimb_scan: ${MODULE.replaceAll(".", "\\.")} could not be read`),
    );
  });
});
