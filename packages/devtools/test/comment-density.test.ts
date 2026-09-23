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

import { rootScripts } from "./root-manifest.ts";

import type { Unit } from "@better-answers/devtools/comment-density";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const WORKSPACE = "packages/probe";
const MIGRATIONS = `${WORKSPACE}/migrations`;

const asWorkspace: Unit = { name: WORKSPACE, kind: "workspace" };
const asDirectory: Unit = { name: MIGRATIONS, kind: "directory" };

const commentLine = "// one comment line that says nothing the code does not\n";
const codeLine = (index: number): string =>
  `export const keep${String(index)} = ${String(index)};\n`;

const withRatio = (comments: number, code: number): string =>
  commentLine.repeat(comments) +
  Array.from({ length: code }, (_, index) => codeLine(index)).join("");

const sqlComment = "-- one comment line that says nothing the statement does not\n";
const sqlLine = (index: number): string => `create table keep${String(index)} (id integer);\n`;

const sqlWithRatio = (comments: number, code: number): string =>
  sqlComment.repeat(comments) + Array.from({ length: code }, (_, index) => sqlLine(index)).join("");

const workspaceTree = (source: string, test: string): Tree => ({
  [`${WORKSPACE}/package.json`]: JSON.stringify({ name: "@better-answers/probe" }),
  [`${WORKSPACE}/src/one.ts`]: source,
  [`${WORKSPACE}/test/one.test.ts`]: test,
});

const UNDER = workspaceTree(withRatio(1, 40), withRatio(1, 40));
const OVER = workspaceTree(withRatio(20, 40), withRatio(1, 40));

// The shape the measurement found: SQL mostly comment beside TypeScript ten times its size,
// which reads under the ceiling while the two share one number.
const diluting = (sql: string): Tree => ({
  [`${WORKSPACE}/package.json`]: JSON.stringify({ name: "@better-answers/probe" }),
  [`${WORKSPACE}/src/one.ts`]: withRatio(1, 400),
  [`${MIGRATIONS}/0000_substrate.sql`]: sql,
});

const DILUTED_OVER = diluting(sqlWithRatio(30, 40));
const DILUTED_UNDER = diluting(sqlWithRatio(2, 40));

const cloc = clocOver([WORKSPACE], { tree: UNDER, counted: 2 });

const yamlComment = "# one comment line that says nothing the key does not\n";
const yamlLine = (index: number): string => `keep${String(index)}: ${String(index)}\n`;

const yamlWithRatio = (comments: number, code: number): string =>
  yamlComment.repeat(comments) +
  Array.from({ length: code }, (_, index) => yamlLine(index)).join("");

describe("the line counter reads what the ceiling is measured on", () => {
  it("counts a Python docstring as a comment, which the ceiling leans on", () => {
    const counted = cloc({
      [`${WORKSPACE}/package.json`]: "{}",
      [`${WORKSPACE}/one.py`]: '"""A docstring."""\n\n\ndef g() -> int:\n    return 1\n',
    });

    expect(counted[0]?.comment).toBe(1);
    expect(counted[0]?.code).toBe(2);
  });

  it("counts a SQL line comment, which is what gives the migrations a number of their own", () => {
    const counted = cloc({
      [`${WORKSPACE}/package.json`]: "{}",
      [`${MIGRATIONS}/0000_substrate.sql`]: sqlWithRatio(2, 1),
    });

    expect(counted[0]?.language).toBe("SQL");
    expect(counted[0]?.comment).toBe(2);
    expect(counted[0]?.code).toBe(1);
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
    const over = overTheCeiling(measure(cloc(OVER), [asWorkspace]));

    expect(over).toHaveLength(1);
    expect(over[0]?.unit).toBe(WORKSPACE);
    expect(over[0]?.arm).toBe("source");
    expect(
      reportOf(over[0] ?? { unit: "", arm: "source", code: 0, comment: 0, ratio: 0 }),
    ).toContain("0.50 comment lines per code line, over the 0.10 ceiling");
  });

  it("stays silent over a tree under both ceilings", () => {
    expect(overTheCeiling(measure(cloc(UNDER), [asWorkspace]))).toEqual([]);
  });

  it("holds a test arm to its own ceiling, not the source one", () => {
    const over = overTheCeiling(
      measure(cloc(workspaceTree(withRatio(1, 40), withRatio(4, 40))), [asWorkspace]),
    );

    expect(over.map((one) => one.arm)).toEqual(["test"]);
  });
});

describe("a directory measured as one unit", () => {
  it("makes a directory one number under the source ceiling, not two arms", () => {
    const measured = measure(
      cloc({
        [`${WORKSPACE}/package.json`]: "{}",
        [`${MIGRATIONS}/0000_substrate.sql`]: sqlWithRatio(4, 40),
        [`${MIGRATIONS}/test/seed.sql`]: sqlWithRatio(2, 40),
      }),
      [asDirectory],
    );

    expect(measured).toHaveLength(1);
    expect(measured[0]?.arm).toBe("source");
    expect(overTheCeiling(measured)).toEqual([]);
  });

  it("measures the migrations apart from the workspace whose TypeScript dilutes them", () => {
    const measured = measure(cloc(DILUTED_OVER), [asWorkspace, asDirectory]);
    const over = overTheCeiling(measured);

    expect(over.map((one) => one.unit)).toEqual([MIGRATIONS]);
    expect(over[0]?.ratio).toBeCloseTo(0.75, 2);
    expect(measured.find((one) => one.unit === WORKSPACE)?.code).toBe(400);
  });

  it("leaves a workspace blind to the SQL beside it, so the seven workspaces do not move", () => {
    const measured = measure(cloc(DILUTED_OVER), [asWorkspace]);

    expect(measured.map((one) => one.unit)).toEqual([WORKSPACE]);
    expect(measured[0]?.comment).toBe(1);
    expect(overTheCeiling(measured)).toEqual([]);
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

describe("the ceiling's wrapper over a directory named as one unit", () => {
  const wrapper = runsOverThrowawayTree({
    executable: WRAPPER_EXECUTABLE,
    argv: ["packages", "--directory", MIGRATIONS],
    foundSomething: [1],
    smoke: { tree: DILUTED_OVER, reports: (output) => output.includes(`${MIGRATIONS} source:`) },
  });

  it("fails with the directory named, where the workspace holding it stays under", () => {
    const output = wrapper(DILUTED_OVER);

    expect(output).toContain(`${MIGRATIONS} source: 0.75 comment lines per code line`);
    expect(output).not.toContain(`${WORKSPACE} source:`);
  });

  it("passes over a directory under the ceiling", () => {
    expect(wrapper(DILUTED_UNDER)).toContain("under the ceiling");
  });

  it("refuses a named directory the tree does not hold, rather than measuring what is left", () => {
    expect(() => wrapper(UNDER)).toThrow(new RegExp(`no directory at ${MIGRATIONS}`));
  });

  it("refuses a named directory it read nothing in, though the workspaces beside it are green", () => {
    expect(() =>
      wrapper({
        ...UNDER,
        [`${MIGRATIONS}/README.md`]: "# a heading\n\nsome prose\n",
      }),
    ).toThrow(new RegExp(`measured no file it understands under ${MIGRATIONS}`));
  });
});

describe("the ceiling's wrapper, asked for something it does not offer", () => {
  const refusing = (argv: readonly string[]) => (): string =>
    runsOverThrowawayTree({
      executable: WRAPPER_EXECUTABLE,
      argv,
      foundSomething: [],
      smoke: { tree: UNDER, reports: () => true },
    })(UNDER);

  it.each([
    [["packages", "--nope"], /Unknown option '--nope'/],
    [["packages", "--directory"], /argument missing/],
    [[], /name at least one root of workspaces/],
  ])("refuses %j", (argv, message) => {
    expect(refusing(argv)).toThrow(message);
  });
});

const CONFIG_FILES = ["one.yml", "two.mjs"] as const;
const NAMED = "the-root-tool-configuration";

const configTree = (comments: number): Tree => ({
  [`${WORKSPACE}/package.json`]: "{}",
  [CONFIG_FILES[0]]: yamlWithRatio(comments, 20),
  [CONFIG_FILES[1]]: withRatio(comments, 20),
});

const asNamed: Unit = { name: NAMED, kind: "directory", holds: [...CONFIG_FILES] };

const clocConfig = clocOver([...CONFIG_FILES], { tree: configTree(1), counted: 2 });

describe("a set of files measured as one named unit", () => {
  it("adds the files up under the name rather than each on its own", () => {
    const measured = measure(clocConfig(configTree(1)), [asNamed]);

    expect(measured).toHaveLength(1);
    expect(measured[0]?.unit).toBe(NAMED);
    expect(measured[0]?.code).toBe(40);
    expect(overTheCeiling(measured)).toEqual([]);
  });

  it("fails under the one name when the set as a whole is over the ceiling", () => {
    const over = overTheCeiling(measure(clocConfig(configTree(6)), [asNamed]));

    expect(over.map((one) => one.unit)).toEqual([NAMED]);
  });
});

describe("the ceiling's wrapper over a set named as one unit", () => {
  const wrapper = runsOverThrowawayTree({
    executable: WRAPPER_EXECUTABLE,
    argv: ["packages", "--unit", `${NAMED}=${CONFIG_FILES.join(",")}`],
    foundSomething: [1],
    smoke: { tree: configTree(6), reports: (output) => output.includes(`${NAMED} source:`) },
  });

  it("names the set, not the files, when it is over the ceiling", () => {
    const output = wrapper(configTree(6));

    expect(output).toContain(`${NAMED} source:`);
    expect(output).not.toContain(CONFIG_FILES[0]);
  });

  it("passes over a set under the ceiling", () => {
    expect(wrapper(configTree(1))).toContain("under the ceiling");
  });

  it("refuses a named file the tree does not hold, rather than measuring what is left", () => {
    expect(() =>
      wrapper({ [`${WORKSPACE}/package.json`]: "{}", [CONFIG_FILES[0]]: "keep: 1\n" }),
    ).toThrow(new RegExp(`${NAMED} names no ${CONFIG_FILES[1]}`));
  });

  it("refuses a --unit that names no set", () => {
    expect(() =>
      runsOverThrowawayTree({
        executable: WRAPPER_EXECUTABLE,
        argv: ["packages", "--unit", "nothing-after-the-name"],
        foundSomething: [],
        smoke: { tree: UNDER, reports: () => true },
      })(UNDER),
    ).toThrow(/--unit takes <name>=<path>/);
  });
});

describe("the root manifest names each config root as a unit of its own", () => {
  it.each([
    "--directory packages/schema/migrations",
    "--directory .claude/hooks",
    "--directory scripts",
    `--unit ${NAMED}=`,
  ])("measures %s apart from the workspaces beside it", (named) => {
    expect(rootScripts()["comment-density"] ?? "").toContain(named);
  });

  it("names the root scripts in the TypeScript comment gate's own command", () => {
    expect((rootScripts()["comment-gate:ts"] ?? "").split(/\s+/)).toContain("scripts");
  });
});
