import {
  CEILING,
  WRAPPER_EXECUTABLE,
  armOf,
  clocArgv,
  clocOver,
  measure,
  overTheCeiling,
  reportOf,
} from "@better-answers/devtools/comment-density";
import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const WORKSPACE = "packages/probe";

const commentLine = "// one comment line that says nothing the code does not\n";
const codeLine = (index: number): string =>
  `export const keep${String(index)} = ${String(index)};\n`;

const withRatio = (comments: number, code: number): string =>
  commentLine.repeat(comments) +
  Array.from({ length: code }, (_, index) => codeLine(index)).join("");

const workspaceTree = (source: string, test: string): Tree => ({
  [`${WORKSPACE}/package.json`]: JSON.stringify({ name: "@better-answers/probe" }),
  [`${WORKSPACE}/src/one.ts`]: source,
  [`${WORKSPACE}/test/one.test.ts`]: test,
});

const UNDER = workspaceTree(withRatio(1, 40), withRatio(1, 40));
const OVER = workspaceTree(withRatio(20, 40), withRatio(1, 40));

const cloc = clocOver([WORKSPACE], { tree: UNDER, counted: 2 });

describe("the line counter reads what the ceiling is measured on", () => {
  it("counts a Python docstring as a comment, which the ceiling leans on", () => {
    const counted = cloc({
      [`${WORKSPACE}/package.json`]: "{}",
      [`${WORKSPACE}/one.py`]: '"""A docstring."""\n\n\ndef g() -> int:\n    return 1\n',
    });

    expect(counted[0]?.comment).toBe(1);
    expect(counted[0]?.code).toBe(2);
  });

  it("gives the counter no per-file guard, which drops the file it fires on and breaks the JSON", () => {
    expect(clocArgv(["packages"]).join(" ")).toContain("--timeout 0");
  });

  it("walks past a workspace's markdown and JSON, which the strip never touched", () => {
    const counted = cloc({
      [`${WORKSPACE}/package.json`]: JSON.stringify({ name: "@better-answers/probe" }),
      [`${WORKSPACE}/README.md`]: "# a heading\n\nsome prose\n",
      [`${WORKSPACE}/src/one.ts`]: withRatio(1, 3),
    });

    expect(counted.map((one) => one.language)).toEqual(["TypeScript"]);
  });
});

describe("the arm a file is measured under", () => {
  it.each([
    ["packages/probe/src/one.ts", "source"],
    ["packages/probe/test/one.test.ts", "test"],
    ["packages/probe/tests/one_test.py", "test"],
    ["apps/web/e2e/screen.spec.ts", "test"],
    ["packages/probe/src/one.test.ts", "test"],
    ["packages/probe/src/test_one.py", "test"],
    ["packages/probe/src/latest.ts", "source"],
  ])("puts %s in the %s arm", (file, arm) => {
    expect(armOf(file)).toBe(arm);
  });

  it("holds a test arm to the tighter of the two ceilings", () => {
    expect(CEILING.test).toBeLessThan(CEILING.source);
  });
});

describe("the ceiling over a throwaway tree", () => {
  it("names the workspace, the arm and the measured ratio when an arm is over", () => {
    const over = overTheCeiling(measure(cloc(OVER), [WORKSPACE]));

    expect(over).toHaveLength(1);
    expect(over[0]?.workspace).toBe(WORKSPACE);
    expect(over[0]?.arm).toBe("source");
    expect(
      reportOf(over[0] ?? { workspace: "", arm: "source", code: 0, comment: 0, ratio: 0 }),
    ).toContain("0.50 comment lines per code line, over the 0.10 ceiling");
  });

  it("stays silent over a tree under both ceilings", () => {
    expect(overTheCeiling(measure(cloc(UNDER), [WORKSPACE]))).toEqual([]);
  });

  it("holds a test arm to its own ceiling, not the source one", () => {
    const over = overTheCeiling(
      measure(cloc(workspaceTree(withRatio(1, 40), withRatio(4, 40))), [WORKSPACE]),
    );

    expect(over.map((one) => one.arm)).toEqual(["test"]);
  });
});

describe("the ceiling's wrapper, run as the root manifest runs it", () => {
  const wrapper = runsOverThrowawayTree({
    executable: WRAPPER_EXECUTABLE,
    argv: ["packages"],
    foundSomething: [1],
    smoke: { tree: OVER, reports: (output) => output.includes("over the 0.10 ceiling") },
  });

  it("fails with the workspace and the ratio named when an arm is over the ceiling", () => {
    expect(wrapper(OVER)).toContain(`${WORKSPACE} source: 0.50 comment lines per code line`);
  });

  it("passes over a tree under both ceilings", () => {
    expect(wrapper(UNDER)).toContain("under the ceiling");
  });

  it("refuses a run that measured nothing rather than calling it clean", () => {
    expect(() => wrapper({ [`${WORKSPACE}/package.json`]: "{}" })).toThrow(
      /measured no file it understands/,
    );
  });
});
