import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

import type { Tool, Tree } from "@better-answers/devtools/throwaway-tree";

const FILE = "probe.py";

const holding = (comment: string): Tree => ({ [FILE]: `${comment}KEEP = 1\n` });

const OVER_THE_CEILING =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty then ten more words after that one here now";

const FORTY_WORDS =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven twentyeight twentynine thirty thirtyone thirtytwo thirtythree thirtyfour thirtyfive thirtysix thirtyseven thirtyeight thirtynine forty";

const A_WHY_OF_TWENTY =
  "Deleting this line changes what the engine memoises, and every caller below then reads a value the store never wrote";

const A_WHY_AT_THE_CEILING = `${A_WHY_OF_TWENTY} until the next release lands`;

const TOO_LONG = `# ${OVER_THE_CEILING}\n`;

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => `word${String(index + 1)}`).join(" ");

const WORKER_MODULE = "apps/worker/src/better_answers_worker/probe.py";

const documented = (signature: string, count: number): string =>
  `${signature}\n    """${words(count)}"""\n    return 1\n`;

// Spelled in two halves, so the tag scan does not read a fixture as a citation.
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
    [
      "a rule tag whose family carries a digit",
      `# Kept because the outcome is announced (${tag("A11Y", "1")}).\n`,
    ],
    ["an ISO date", "# Kept because the reading of the registry moved on 2026-09-21.\n"],
    ["a slashed date", "# Kept because the reading of the registry moved on 21/09/2026.\n"],
  ])("refuses a comment citing %s", (_what, comment) => {
    expect(findings(holding(comment))).toHaveLength(1);
  });

  it("counts a run of touching hash lines as one block", () => {
    const eightShortLines = Array.from({ length: 8 }, () => "# four more words here\n").join("");

    expect(findings(holding(eightShortLines))).toHaveLength(1);
  });

  it("counts a paragraph broken by a bare `#` line as one block", () => {
    const broken = `# ${words(13)}\n#\n# ${words(13)}\n`;

    expect(run(holding(broken))).toContain("runs to 26 words");
  });

  it("keeps a trailing comment out of the block above it", () => {
    const above = `# ${A_WHY_OF_TWENTY}\nKEEP = 1  # ${A_WHY_OF_TWENTY}\n`;

    expect(findings({ [FILE]: above })).toEqual([]);
  });

  it("keeps a trailing comment out of the block below it", () => {
    const below = `KEEP = 1  # ${A_WHY_OF_TWENTY}\n# ${A_WHY_OF_TWENTY}\nMORE = 2\n`;

    expect(findings({ [FILE]: below })).toEqual([]);
  });

  it("reports a long comment that cites a ticket once, for the citation", () => {
    const output = run(holding(`# ${OVER_THE_CEILING} under T-243\n`));

    expect(output.trim().split("\n")).toHaveLength(1);
    expect(output).toContain("cites a ticket id");
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

  it("walks past a licence notice held in a module docstring", () => {
    const notice = `"""Copyright 2026 the authors. ${OVER_THE_CEILING}"""\n\nKEEP = 1\n`;

    expect(findings({ [FILE]: notice })).toEqual([]);
  });

  it("holds a docstring that opens with a directive's word to the ceiling", () => {
    const opening = `"""noqa ${OVER_THE_CEILING}"""\n\nKEEP = 1\n`;

    expect(findings({ [FILE]: opening })).toHaveLength(1);
  });

  it("walks past a hashbang, which deleting would break a command", () => {
    expect(findings({ [FILE]: "#!/usr/bin/env python3\nKEEP = 1\n" })).toEqual([]);
  });

  it("keeps a directive's words out of the paragraph under it", () => {
    expect(findings(holding(`# fmt: off\n# ${A_WHY_AT_THE_CEILING}\n`))).toEqual([]);
  });

  it("does not lend a directive's exemption to the paragraph under it", () => {
    expect(findings(holding(`# type: ignore[attr-defined]\n${TOO_LONG}`))).toHaveLength(1);
  });

  it("stays silent over a tree whose comments are all short and cite nothing", () => {
    expect(findings(holding("# Deleting this changes what the engine memoises.\n"))).toEqual([]);
  });

  it("counts the words after the marker, however many open the comment", () => {
    expect(findings(holding(`## ${A_WHY_AT_THE_CEILING}\n`))).toEqual([]);
  });

  it("reads a `#` inside a string as a string", () => {
    expect(findings({ [FILE]: `KEEP = "# ${OVER_THE_CEILING}"\n` })).toEqual([]);
  });
});

describe("a directive's reason counts against the twenty-five words", () => {
  it.each([
    ["a noqa", "import os  # noqa: F401"],
    ["a type-checker escape", "KEEP: int = 1  # type: ignore[assignment]"],
  ])(
    "refuses %s whose reason runs to twenty-six words, naming the directive rule",
    (_what, line) => {
      const output = run({ [FILE]: `${line}  # ${words(26)}\n` });

      expect(output).toContain("reason runs to 26 words");
      expect(output).toContain(tag("COMMENT", "3"));
    },
  );

  it("holds a reason to its own directive, never to the comment above it", () => {
    const source = `# ${words(20)}\n# type: ignore  # ${words(20)}\nKEEP = 1\n`;

    expect(findings({ [FILE]: source })).toEqual([]);
  });

  it.each([
    ["a noqa", "import os  # noqa: F401, E501"],
    ["a type-checker escape", "KEEP: int = 1  # type: ignore[assignment]"],
  ])("refuses %s whose reason follows on with no second marker", (_what, line) => {
    const output = run({ [FILE]: `${line} - ${words(26)}\n` });

    expect(output).toContain("runs to 26 words");
  });

  it("counts none of the directive's own words", () => {
    const codes = Array.from({ length: 30 }, (_, index) => `E${String(index + 100)}`).join(", ");

    expect(findings({ [FILE]: `KEEP = 1  # noqa: ${codes}\n` })).toEqual([]);
  });

  it("accepts a noqa whose reason fits the ceiling", () => {
    expect(findings({ [FILE]: `import os  # noqa: F401  # ${A_WHY_AT_THE_CEILING}\n` })).toEqual(
      [],
    );
  });

  it("refuses a directive's reason that cites a ticket", () => {
    const citing = "import os  # noqa: F401  # the loader changed under T-243\n";

    expect(findings({ [FILE]: citing })).toHaveLength(1);
  });
});

describe("a public worker function's docstring may run to fifty words", () => {
  it.each([
    ["a public worker function", "def reads() -> int:"],
    ["a public async worker function", "async def reads() -> int:"],
  ])("accepts a fifty-word docstring on %s", (_what, signature) => {
    expect(findings({ [WORKER_MODULE]: documented(signature, 50) })).toEqual([]);
  });

  it("refuses a fifty-one-word docstring on a public worker function", () => {
    const output = run({ [WORKER_MODULE]: documented("def reads() -> int:", 51) });

    expect(output).toContain("runs to 51 words");
    expect(output).toContain("in 50 at most");
  });

  it.each([
    ["an internal worker function", WORKER_MODULE, documented("def _reads() -> int:", 26)],
    [
      "a method, which is a member",
      WORKER_MODULE,
      `class Reader:\n    def reads(self) -> int:\n        """${words(26)}"""\n        return 1\n`,
    ],
    [
      "a function nested in a public one",
      WORKER_MODULE,
      `def reads() -> int:\n    def inner() -> int:\n        """${words(26)}"""\n        return 1\n    return inner()\n`,
    ],
    ["the worker module itself", WORKER_MODULE, `"""${words(26)}"""\n\nKEEP = 1\n`],
    [
      "a line comment above a public function",
      WORKER_MODULE,
      `# ${words(26)}\ndef reads() -> int:\n    return 1\n`,
    ],
    [
      "a public function in the worker's tests",
      "apps/worker/tests/test_probe.py",
      documented("def test_reads() -> int:", 26),
    ],
    [
      "a public function outside the worker",
      "packages/devtools/python/probe.py",
      documented("def reads() -> int:", 26),
    ],
  ])("holds %s to twenty-five words", (_what, file, source) => {
    const output = run({ [file]: source });

    expect(output).toContain("runs to 26 words");
    expect(output).toContain("in 25 at most");
  });
});

describe("the Python check reads Python files and nothing else", () => {
  it.each([
    ["YAML", "probe.yml", `# ${FORTY_WORDS}\nkeep: 1\n`],
    ["shell", "probe.sh", `# ${FORTY_WORDS}\nKEEP=1\n`],
    ["TOML", "probe.toml", `# ${FORTY_WORDS}\nkeep = 1\n`],
    ["SQL", "probe.sql", `-- ${FORTY_WORDS}\nSELECT 1;\n`],
    [
      "a workspace's tool configuration",
      "apps/worker/pyproject.toml",
      `# ${FORTY_WORDS}\nkeep = 1\n`,
    ],
    ["markdown", "probe.md", `# ${FORTY_WORDS}\n`],
  ])("walks past a forty-word comment in %s", (_what, file, source) => {
    expect(findings({ [file]: source })).toEqual([]);
  });

  it("walks past a config file named on its command line", () => {
    const named = runsOverThrowawayTree({
      ...gate,
      argv: ["probe.toml", FILE],
      smoke: {
        tree: { ...holding(TOO_LONG), "probe.toml": "keep = 1\n" },
        reports: (output) => output.includes(`${FILE}:`),
      },
    });

    const output = named({ ...holding(TOO_LONG), "probe.toml": `# ${FORTY_WORDS}\nkeep = 1\n` });

    expect(output).not.toContain("probe.toml");
  });

  it("walks past a skill, which is prose and is read by no gate", () => {
    const skill = { "packages/devtools/.claude/skills/probe/example.py": TOO_LONG };

    expect(findings(skill)).toEqual([]);
  });
});

describe("the Python check refuses what a reader cannot open from where they read it", () => {
  const saying = (text: string): Tree => ({ [FILE]: `USAGE = "${text}"\n` });

  it.each([
    ["a ticket id", "Ask the owner about T-243 first."],
    ["an ADR number", "The graph is Postgres under ADR 0021."],
    ["an ISO date", "The registry moved on 2026-09-21."],
    ["a slashed date", "The registry moved on 21/09/2026."],
  ])("refuses a string citing %s", (_what, text) => {
    expect(findings(saying(text))).toHaveLength(1);
  });

  it("refuses a rule tag in a string, which a comment scan never reached", () => {
    expect(findings(saying(`A raw insert lives in a factory (${tag("TEST", "4")}).`))).toHaveLength(
      1,
    );
  });

  it("counts a docstring citing a ticket once, not twice", () => {
    expect(findings({ [FILE]: `"""Kept under T-243."""\n\nKEEP = 1\n` })).toHaveLength(1);
  });

  it("stays silent over a string that names what the reader can do", () => {
    expect(findings(saying("Name a workspace this person belongs to."))).toEqual([]);
  });

  it("walks past a value with no prose in it, which no reader reads as a sentence", () => {
    expect(findings({ [FILE]: 'READ_ON = "2026-09-11"\n' })).toEqual([]);
  });

  it("walks past the same string in a test", () => {
    const inATest = { "tests/test_probe.py": 'USAGE = "The graph is Postgres under ADR 0021."\n' };

    expect(findings(inATest)).toEqual([]);
  });

  it("walks past the same string in the gate that prints its own tag", () => {
    const inAGate = {
      "packages/devtools/python/comment_gate.py": `SAID = "A raw insert lives in a factory (${tag("TEST", "4")})."\n`,
    };

    expect(findings(inAGate)).toEqual([]);
  });
});

describe("the check refuses to answer for a file it could not read", () => {
  it("exits on a file it cannot parse rather than reporting a clean tree", () => {
    expect(() => run({ [FILE]: "def broken(\n" })).toThrow(/could not be read/);
  });
});
