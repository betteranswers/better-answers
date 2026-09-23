import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  executableOf,
  oxlintOver,
  runsOverThrowawayTree,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";
import { pluginConfigFor, repositoryRoot } from "@better-answers/devtools/oxlint-config";
import {
  commentGateRoots,
  typeScriptGateArgv,
  typeScriptGateConfig,
} from "@better-answers/devtools/root-commands";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/comment-only-the-why";
const FILE = "probe.ts";

const OXLINT = { package: "oxlint", path: ["bin", "oxlint"] } as const;

const CONFIG = pluginConfigFor({ [RULE]: "error" });

const holding = (comment: string): Tree => ({ [FILE]: `${comment}export const keep = 1;\n` });

// Split so vitest does not read this suite's own environment off the fixture.
const ENVIRONMENT_DOCBLOCK = `/** @vitest-${"environment"} happy-dom */\n`;

// Spelled in two halves, so the tag scan does not read a fixture as a citation.
const tag = (family: string, number: string): string => `[${family}${number}]`;

const OVER_THE_CEILING =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty then ten more words after that one here now";

const TOO_LONG = `// ${OVER_THE_CEILING}\n`;

const lint = oxlintOver(CONFIG, { tree: holding(TOO_LONG), flagged: [FILE] });

describe("the comment rule fires on the two shapes a tool can read", () => {
  it("refuses a block over the ceiling, naming the count and its rule", () => {
    const output = lint.output(holding(TOO_LONG));

    expect(output).toContain("runs to 29 words");
    expect(output).toContain(tag("COMMENT", "1"));
    expect(output).toContain("better-answers(comment-only-the-why)");
  });

  it.each([
    ["a ticket id", "// Kept because the claim protocol changed under T-243.\n"],
    ["an ADR number", "// Kept because the graph is Postgres under ADR 0021.\n"],
    ["a rule tag", `// Kept because a raw insert lives in a factory (${tag("TEST", "4")}).\n`],
    [
      "a rule tag whose family carries a digit",
      `// Kept because the outcome is announced (${tag("A11Y", "1")}).\n`,
    ],
    ["an ISO date", "// Kept because the reading of the registry moved on 2026-09-21.\n"],
    ["a slashed date", "// Kept because the reading of the registry moved on 21/09/2026.\n"],
  ])("refuses a comment citing %s", (_what, comment) => {
    expect(lint.flagged(holding(comment))).toEqual([FILE]);
  });

  it("counts a run of touching line comments as one block", () => {
    const eightShortLines = Array.from({ length: 8 }, () => "// four more words here\n").join("");

    expect(lint.flagged(holding(eightShortLines))).toEqual([FILE]);
  });

  it("refuses a comment inside JSX, which the line counter cannot see", () => {
    const tsx = {
      "screen.tsx": `export const Screen = () => (\n  <div>{/* ${OVER_THE_CEILING} */}</div>\n);\n`,
    };

    expect(lint.flagged(tsx)).toEqual(["screen.tsx"]);
  });
});

describe("the comment rule stays silent where a comment earns its place", () => {
  it.each([
    ["a why inside the ceiling", "// Deleting this changes what knip answers.\n"],
    [
      "a lint disable with its reason",
      "// eslint-disable-next-line no-console -- the check runner prints\n",
    ],
    [
      "a type-checker escape",
      "// @ts-expect-error the fixture is deliberately the wrong shape for T-243\n",
    ],
    ["a copy-detection fence", "/* jscpd:ignore-start */\n/* jscpd:ignore-end */\n"],
    ["a test environment docblock", ENVIRONMENT_DOCBLOCK],
    ["a triple-slash reference", '/// <reference types="node" />\n'],
    ["a licence notice", "// SPDX-License-Identifier: MIT\n"],
  ])("walks past %s", (_what, comment) => {
    expect(lint.flagged(holding(comment))).toEqual([]);
  });

  it("walks past a hashbang, which deleting would break a command", () => {
    expect(lint.flagged({ [FILE]: "#!/usr/bin/env node\nexport const keep = 1;\n" })).toEqual([]);
  });

  it("does not lend a directive's exemption to the paragraph under it", () => {
    const both = `// oxlint-disable-next-line no-console\n${TOO_LONG}`;

    expect(lint.flagged(holding(both))).toEqual([FILE]);
  });

  it("stays silent over a tree whose comments are all short and cite nothing", () => {
    expect(lint.flagged(holding("// Deleting this changes what knip answers.\n"))).toEqual([]);
  });
});

describe("the string check refuses what a reader cannot open from where they read it", () => {
  const saying = (text: string): Tree => ({ [FILE]: `export const usage = "${text}";\n` });

  it.each([
    ["a ticket id", "Ask the owner about T-243 first."],
    ["an ADR number", "The graph is Postgres under ADR 0021."],
    ["an ISO date", "The registry moved on 2026-09-21."],
    ["a slashed date", "The registry moved on 21/09/2026."],
  ])("refuses a string citing %s", (_what, text) => {
    expect(lint.flagged(saying(text))).toEqual([FILE]);
  });

  it("refuses a rule tag in a string, which a comment scan never reached", () => {
    expect(lint.flagged(saying(`A raw insert lives in a factory (${tag("TEST", "4")}).`))).toEqual([
      FILE,
    ]);
  });

  it("refuses a citation in a template literal's text", () => {
    const template = {
      [FILE]: "export const usage = (id: string): string => `${id} landed under T-243.`;\n",
    };

    expect(lint.flagged(template)).toEqual([FILE]);
  });

  it("stays silent over a string that names what the reader can do", () => {
    expect(lint.flagged(saying("Name a workspace this person belongs to."))).toEqual([]);
  });

  it("walks past a value with no prose in it, which no reader reads as a sentence", () => {
    const profile = { [FILE]: 'export const profile = "mcp-2026-07-28";\n' };

    expect(lint.flagged(profile)).toEqual([]);
  });

  it("walks past the same string in a test", () => {
    const inATest = {
      "tests/probe.ts": 'export const usage = "The graph is Postgres under ADR 0021.";\n',
    };

    expect(lint.flagged(inATest)).toEqual([]);
  });

  it("walks past the same string in a gate that prints its own tag", () => {
    const inAGate = {
      "packages/devtools/src/insert-scan.ts": `export const said = "A raw insert lives in a factory (${tag("TEST", "4")}).";\n`,
    };

    expect(lint.flagged(inAGate)).toEqual([]);
  });
});

describe("the rule's fix", () => {
  const fixed = (tree: Tree): string => {
    const directory = mkdtempSync(path.join(tmpdir(), "comment-fix-"));
    writeUnder(directory, ".oxlintrc.json", CONFIG);
    for (const [file, source] of Object.entries(tree)) writeUnder(directory, file, source);
    execFileSync(executableOf(OXLINT), ["--config", ".oxlintrc.json", "--fix", "."], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readFileSync(path.join(directory, FILE), "utf8");
  };

  it("removes the offending comment and leaves the code", () => {
    const after = fixed(holding(TOO_LONG));

    expect(after).not.toContain(OVER_THE_CEILING);
    expect(after).toContain("export const keep = 1;");
  });

  it("leaves a directive alone", () => {
    const directive = "// oxlint-disable-next-line no-console\n";
    const after = fixed(holding(`${directive}${TOO_LONG}`));

    expect(after).toContain("oxlint-disable-next-line no-console");
    expect(after).not.toContain(OVER_THE_CEILING);
  });
});

const FORTY_WORDS =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven twentyeight twentynine thirty thirtyone thirtytwo thirtythree thirtyfour thirtyfive thirtysix thirtyseven thirtyeight thirtynine forty";

const A_WHY_OF_TWENTY =
  "The strip reads this file, so a comment left here is one the next run of it would silently take away again";

const A_ROOT_SCRIPT = "scripts/probe.mjs";

const jsonConfig = z.looseObject({
  jsPlugins: z.array(z.looseObject({ specifier: z.string() })),
});

// The gate's own config, JSONC, with its plugin resolved to this checkout's so the throwaway
// tree needs no dependencies of its own.
const gateConfig = (): string => {
  const relative = typeScriptGateConfig();
  const source = readFileSync(path.join(repositoryRoot, relative), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  const parsed = jsonConfig.parse(JSON.parse(source));
  return JSON.stringify({
    ...parsed,
    jsPlugins: parsed.jsPlugins.map((one) => ({
      ...one,
      specifier: path.resolve(repositoryRoot, path.dirname(relative), one.specifier),
    })),
  });
};

// Something clean at every root the command names, so a run fails on the probe and never on a
// path this tree does not hold.
const scaffold = (): Tree =>
  Object.fromEntries([
    [typeScriptGateConfig(), gateConfig()],
    ...commentGateRoots().map((root) =>
      /\.[cm]?[jt]sx?$/.test(root)
        ? [root, "export const keep = 1;\n"]
        : [`${root}/keep.ts`, "export const keep = 1;\n"],
    ),
  ]);

const scriptHolding = (comment: string): Tree => ({
  [A_ROOT_SCRIPT]: `${comment}export const keep = 1;\n`,
});

const OVER_IN_A_SCRIPT = scriptHolding(`// ${FORTY_WORDS}\n`);

describe("the gate's own command reaches the root scripts directory", () => {
  const gate = runsOverThrowawayTree({
    executable: OXLINT,
    // Pinned, as the rule's own runner pins it: a reporter that names no file reads as silence.
    argv: [...typeScriptGateArgv(), "--format=unix"],
    scaffold: scaffold(),
    foundSomething: [1],
    // Smoked under a root the command has always named, so dropping `scripts` fails the case
    // below by its own assertion, not this runner.
    smoke: {
      tree: { "packages/devtools/probe.ts": `// ${FORTY_WORDS}\nexport const keep = 1;\n` },
      reports: (output) => output.includes("runs to 40 words"),
    },
  });

  it("refuses a 40-word comment in a root script, naming the file, the count and the rule", () => {
    const output = gate(OVER_IN_A_SCRIPT);

    expect(output).toContain(`${A_ROOT_SCRIPT}:`);
    expect(output).toContain("runs to 40 words");
    expect(output).toContain(tag("COMMENT", "1"));
  });

  it("stays silent over a why of twenty words in the same script", () => {
    expect(gate(scriptHolding(`// ${A_WHY_OF_TWENTY}\n`))).toBe("");
  });
});
