import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

import type { Tool, Tree } from "@better-answers/devtools/throwaway-tree";

const FILE = "probe.py";

const holding = (comment: string): Tree => ({ [FILE]: `${comment}KEEP = 1\n` });

const OVER_THE_CEILING =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty then ten more words after that one here now";

const TOO_LONG = `# ${OVER_THE_CEILING}\n`;

const tag = (family: string, number: string): string => `[${family}${number}]`;

const gate: Tool = {
  executable: { package: "@better-answers/devtools", path: ["python", "comment_gate.py"] },
  argv: ["."],
  foundSomething: [1],
  smoke: { tree: holding(TOO_LONG), reports: (output) => /^probe\.py:\d+: /m.test(output) },
};

const run = runsOverThrowawayTree(gate);

const findings = (tree: Tree): readonly string[] =>
  run(tree)
    .split("\n")
    .filter((line) => line !== "");

describe("the Python check fires on the two shapes a tool can read", () => {
  it("refuses a comment over the ceiling, naming the count and its rule", () => {
    const output = run(holding(TOO_LONG));

    expect(output).toContain("runs to 29 words");
    expect(output).toContain(tag("COMMENT", "1"));
  });

  it("counts a docstring as a comment, which no ruff rule does", () => {
    const module = { [FILE]: `"""${OVER_THE_CEILING}"""\n\nKEEP = 1\n` };

    expect(findings(module)).toHaveLength(1);
  });

  it("reads a function's docstring as well as the module's", () => {
    const both = {
      [FILE]: `"""${OVER_THE_CEILING}"""\n\n\ndef g() -> int:\n    """${OVER_THE_CEILING}"""\n    return 1\n`,
    };

    expect(findings(both)).toHaveLength(2);
  });

  it.each([
    ["a ticket id", "# Kept because the claim protocol changed under T-243.\n"],
    ["an ADR number", "# Kept because the graph is Postgres under ADR 0021.\n"],
    ["a rule tag", `# Kept because a raw insert lives in a factory (${tag("TEST", "4")}).\n`],
    ["an ISO date", "# Kept because the reading of the registry moved on 2026-09-21.\n"],
    ["a slashed date", "# Kept because the reading of the registry moved on 21/09/2026.\n"],
  ])("refuses a comment citing %s", (_what, comment) => {
    expect(findings(holding(comment))).toHaveLength(1);
  });

  it("counts a run of touching hash lines as one block", () => {
    const eightShortLines = Array.from({ length: 8 }, () => "# four more words here\n").join("");

    expect(findings(holding(eightShortLines))).toHaveLength(1);
  });
});

describe("the Python check stays silent where a comment earns its place", () => {
  it.each([
    ["a why inside the ceiling", "# Deleting this changes what the engine memoises.\n"],
    ["a type-checker escape", "# type: ignore[attr-defined]\n"],
    ["a linter escape", "# noqa: E501\n"],
    ["a coverage pragma", "# pragma: no cover\n"],
    ["a copy-detection fence", "# jscpd:ignore-start\n# jscpd:ignore-end\n"],
    ["a licence notice", "# SPDX-License-Identifier: MIT\n"],
  ])("walks past %s", (_what, comment) => {
    expect(findings(holding(comment))).toEqual([]);
  });

  it("walks past a hashbang, which deleting would break a command", () => {
    expect(findings({ [FILE]: "#!/usr/bin/env python3\nKEEP = 1\n" })).toEqual([]);
  });

  it("does not lend a directive's exemption to the paragraph under it", () => {
    expect(findings(holding(`# type: ignore[attr-defined]\n${TOO_LONG}`))).toHaveLength(1);
  });

  it("stays silent over a tree whose comments are all short and cite nothing", () => {
    expect(findings(holding("# Deleting this changes what the engine memoises.\n"))).toEqual([]);
  });

  it("reads a `#` inside a string as a string", () => {
    expect(findings({ [FILE]: `KEEP = "# ${OVER_THE_CEILING}"\n` })).toEqual([]);
  });
});

describe("the Python check refuses to answer for a file it could not read", () => {
  it("exits on a file it cannot parse rather than reporting a clean tree", () => {
    expect(() => run({ [FILE]: "def broken(\n" })).toThrow(/could not be read/);
  });
});
