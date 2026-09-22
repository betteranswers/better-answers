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

const CITING = "Kept because the claim protocol changed under T-243.";

const TOO_LONG = `# ${OVER_THE_CEILING}\n`;

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

type Language = readonly [
  name: string,
  file: string,
  marker: string,
  keep: string,
  directive: string,
];

const LANGUAGES: readonly Language[] = [
  [
    "YAML",
    "probe.yml",
    "#",
    "keep: 1\n",
    "# yaml-language-server: $schema=https://cubic.dev/schema/cubic-repository-config.schema.json\n",
  ],
  ["shell", "probe.sh", "#", "KEEP=1\n", "# shellcheck disable=SC2016\n"],
  [
    "TOML",
    "probe.toml",
    "#",
    "keep = 1\n",
    "# renovate: datasource=github-tags depName=rclone/rclone\n",
  ],
  ["SQL", "probe.sql", "--", "SELECT 1;\n", "--> statement-breakpoint\n"],
  ["Python", "probe.py", "#", "KEEP = 1\n", "# type: ignore[attr-defined]\n"],
];

describe.each(LANGUAGES)(
  "the check reads a comment in %s, on the two conditions the code tree holds",
  (_name, file, marker, keep, directive) => {
    const saying = (prose: string): Tree => ({ [file]: `${marker} ${prose}\n${keep}` });

    it("refuses a comment of forty words", () => {
      expect(findings(saying(FORTY_WORDS))).toHaveLength(1);
    });

    it("refuses a comment citing a ticket", () => {
      expect(findings(saying(CITING))).toHaveLength(1);
    });

    it("walks past a directive", () => {
      expect(findings({ [file]: `${directive}${keep}` })).toEqual([]);
    });

    it("walks past a why of twenty words", () => {
      expect(findings(saying(A_WHY_OF_TWENTY))).toEqual([]);
    });

    it("counts the words after the marker, however many characters open the comment", () => {
      const doubled = { [file]: `${marker}${marker} ${A_WHY_AT_THE_CEILING}\n${keep}` };

      expect(findings(doubled)).toEqual([]);
    });
  },
);

describe("the check walks past a directive, which is machinery and not prose", () => {
  it.each([
    ["a shebang", "probe.sh", "#!/usr/bin/env bash\nKEEP=1\n"],
    ["a shellcheck line", "probe.sh", "# shellcheck disable=SC2016\nKEEP=1\n"],
    [
      "a renovate line",
      "probe.yml",
      "# renovate: datasource=github-tags depName=rclone/rclone\nkeep: 1\n",
    ],
    [
      "a yaml-language-server line",
      "probe.yml",
      "# yaml-language-server: $schema=https://cubic.dev/schema/cubic-repository-config.schema.json\nkeep: 1\n",
    ],
    ["a noqa line", "probe.py", "# noqa: E501\nKEEP = 1\n"],
    [
      "a pin tag beside a uses line",
      "probe.yml",
      "steps:\n  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n",
    ],
    [
      "a compose key comment naming a version",
      "probe.yml",
      "services:\n  cache:\n    image: alpine:3.23.5 # alpine 3.23.5\n",
    ],
    [
      "a lefthook key comment naming a version",
      "probe.yml",
      "pre-commit:\n  commands:\n    lint:\n      run: oxlint # oxlint 1.42.0\n",
    ],
    [
      "the migrations' separator on its own line",
      "probe.sql",
      "SELECT 1;\n--> statement-breakpoint\nSELECT 2;\n",
    ],
    [
      "the migrations' separator on a statement line",
      "probe.sql",
      "SELECT 1;--> statement-breakpoint\nSELECT 2;\n",
    ],
    [
      "the migrations' hand-written marker",
      "probe.sql",
      "-- Custom migration (hand-written SQL; ADR 0032).\nSELECT 1;\n",
    ],
  ])("walks past %s", (_what, file, source) => {
    expect(findings({ [file]: source })).toEqual([]);
  });

  it("reads a marker that is not the migrations' own as the citation it carries", () => {
    const near = "-- Custom migration (hand-written SQL; ADR 0033).\nSELECT 1;\n";

    expect(findings({ "probe.sql": near })).toHaveLength(1);
  });
});

describe("the check reads what a language calls code as code", () => {
  it.each([
    ["a quoted scalar in YAML", "probe.yml", `keep: "# ${FORTY_WORDS}"\n`],
    ["a quoted word in shell", "probe.sh", `echo "# ${FORTY_WORDS}"\n`],
    ["a basic string in TOML", "probe.toml", `keep = "# ${FORTY_WORDS}"\n`],
    ["a string in SQL", "probe.sql", `SELECT '-- ${FORTY_WORDS}';\n`],
    ["an escaped string in SQL", "probe.sql", `SELECT E'-- ${FORTY_WORDS}';\n`],
    ["a quoted identifier in SQL", "probe.sql", `SELECT 1 AS "-- ${FORTY_WORDS}";\n`],
    [
      "a dollar-quoted body in SQL",
      "probe.sql",
      `CREATE FUNCTION f() RETURNS int AS $$\nBEGIN\n  -- ${FORTY_WORDS}\n  RETURN 1;\nEND;\n$$ LANGUAGE plpgsql;\n`,
    ],
    [
      "a tagged dollar-quoted body in SQL",
      "probe.sql",
      `CREATE FUNCTION f() RETURNS int AS $body$\n  -- ${FORTY_WORDS}\n  SELECT 1;\n$body$ LANGUAGE sql;\n`,
    ],
  ])("says nothing about %s", (_what, file, source) => {
    expect(findings({ [file]: source })).toEqual([]);
  });

  it("lexes a SQL line comment before a slash-star, so a glob closes at the line", () => {
    const glob = `-- the redirect covers /oauth2/*\nSELECT 1;\n-- ${FORTY_WORDS}\nSELECT 2;\n`;

    expect(findings({ "probe.sql": glob })).toHaveLength(1);
  });
});

describe("the check speaks only for a root the strip has wired", () => {
  it.each([
    [
      "the migrations, which are wired by their own strip",
      "packages/schema/migrations/0000_probe.sql",
      `-- ${FORTY_WORDS}\nSELECT 1;\n`,
    ],
    [
      "a workspace's tool configuration, which no root covers",
      "apps/worker/pyproject.toml",
      `# ${FORTY_WORDS}\nkeep = 1\n`,
    ],
    [
      "a skill, which is prose and is read by no gate",
      "packages/devtools/.claude/skills/probe/example.yml",
      `# ${FORTY_WORDS}\nkeep: 1\n`,
    ],
  ])("walks past %s", (_what, file, source) => {
    expect(findings({ [file]: source })).toEqual([]);
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

  it("walks past a file its syntax table has no reader for", () => {
    expect(findings({ "probe.md": `# ${FORTY_WORDS}\n` })).toEqual([]);
  });
});
