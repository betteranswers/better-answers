import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { executableOf, oxlintOver, writeUnder } from "@better-answers/devtools/throwaway-tree";
import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { describe, expect, it } from "vitest";

import { tag, wordsOf } from "./fixture-text.ts";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/comment-only-the-why";
const FILE = "probe.ts";
const CORE = "packages/core/src/probe.ts";

const OXLINT = { package: "oxlint", path: ["bin", "oxlint"] } as const;

const CONFIG = pluginConfigFor({ [RULE]: "error" });

const holding = (comment: string, code = "export const keep = 1;\n"): Tree => ({
  [FILE]: `${comment}${code}`,
});

/** Split so vitest does not read this suite's own environment off the fixture. */
const ENVIRONMENT_DOCBLOCK = `/** @vitest-${"environment"} happy-dom */\n`;

const TOO_LONG = `// ${wordsOf(29)}\n`;

const lint = oxlintOver(CONFIG, { tree: holding(TOO_LONG), flagged: [FILE] });

describe("the comment rule fires on a long or citing comment", () => {
  it("refuses a block over the ceiling, naming count and rule", () => {
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
      "a tag from a digit-bearing family",
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

  it("counts line comments a blank line apart as two blocks", () => {
    const apart = `// ${wordsOf(20)}\n\n// ${wordsOf(20)}\n`;

    expect(lint.flagged(holding(apart))).toEqual([]);
  });

  it.each([
    [
      "a line comment under a trailing one",
      `export const a = 1; // ${wordsOf(20)}\n// ${wordsOf(20)}\n`,
    ],
    [
      "a trailing comment under a line one",
      `// ${wordsOf(20)}\nexport const a = 1; // ${wordsOf(20)}\n`,
    ],
    ["a block comment under a line one", `// ${wordsOf(20)}\n/* ${wordsOf(20)} */\n`],
    ["a line comment under a block one", `/* ${wordsOf(20)} */\n// ${wordsOf(20)}\n`],
  ])("counts %s separately", (_what, source) => {
    expect(lint.flagged(holding(source))).toEqual([]);
  });

  it("counts a run of indented line comments as one block", () => {
    const indented = `export const f = (): number => {\n  // ${wordsOf(13)}\n  // ${wordsOf(13)}\n  return 1;\n};\n`;

    expect(lint.flagged({ [FILE]: indented })).toEqual([FILE]);
  });

  it("counts a multi-line doc block's words, never its asterisks", () => {
    const lines = Array.from({ length: 5 }, () => ` * ${wordsOf(5)}\n`).join("");

    expect(lint.flagged(holding(`/**\n${lines} */\n`))).toEqual([]);
  });

  it("counts no words in a banner of asterisks", () => {
    expect(lint.flagged(holding(`/*****\n * ${wordsOf(25)}\n *****/\n`))).toEqual([]);
  });

  it("keeps a block's words apart across its line breaks", () => {
    const lines = Array.from({ length: 26 }, (_unused, index) => `word${String(index)}\n`).join("");

    expect(lint.flagged(holding(`/*\n${lines}*/\n`))).toEqual([FILE]);
  });

  it.each([
    ["an oxlint disable", "the oxlint-disable-next-line form"],
    ["an enable", "the eslint-enable form"],
    ["a Stryker restore", "the Stryker restore form"],
    ["a type-checker escape", "the @ts-expect-error form"],
    ["a notice", "the SPDX-License-Identifier line"],
  ])("reads %s named mid-sentence as prose", (_what, named) => {
    const source = `// ${wordsOf(12)}\n// ${named} is named here\n// ${wordsOf(12)}\n`;

    expect(lint.flagged(holding(source)), "prose, never a directive").toEqual([FILE]);
  });

  it.each([
    ["a triple-slash reference", '/// <reference types="node" />'],
    ["a triple-slash reference with no space", '///<reference types="node" />'],
    ["a Stryker restore", "// Stryker restore all"],
    ["a coverage directive", "// v8 ignore next"],
  ])("ends a block at %s", (_what, notice) => {
    const source = `// ${wordsOf(20)}\n${notice}\n// ${wordsOf(20)}\n`;

    expect(lint.flagged(holding(source))).toEqual([]);
  });

  it("refuses a comment inside JSX, which the line counter misses", () => {
    const tsx = {
      "screen.tsx": `export const Screen = () => (\n  <div>{/* ${wordsOf(29)} */}</div>\n);\n`,
    };

    expect(lint.flagged(tsx)).toEqual(["screen.tsx"]);
  });
});

describe("the comment rule's exemptions", () => {
  it.each([
    ["a why inside the ceiling", "// Deleting this changes what knip answers.\n"],
    ["a why of exactly 25 words", `// ${wordsOf(25)}\n`],
    ["a copy-detection fence", "/* jscpd:ignore-start */\n/* jscpd:ignore-end */\n"],
    ["a test environment docblock", ENVIRONMENT_DOCBLOCK],
    ["a triple-slash reference", '/// <reference types="node" />\n'],
    ["a licence notice", "// SPDX-License-Identifier: MIT\n"],
    ["an enable, which suppresses nothing to explain", "// oxlint-enable no-console\n"],
  ])("walks past %s", (_what, comment) => {
    expect(lint.flagged(holding(comment))).toEqual([]);
  });

  it("walks past a hashbang, which deleting would break a command", () => {
    expect(lint.flagged({ [FILE]: "#!/usr/bin/env node\nexport const keep = 1;\n" })).toEqual([]);
  });

  it("keeps a directive's exemption off the paragraph under it", () => {
    const both = `// oxlint-disable-next-line no-console -- the runner prints\n${TOO_LONG}`;

    expect(lint.flagged(holding(both))).toEqual([FILE]);
  });
});

describe("the comment rule holds a directive to a same-line reason", () => {
  it.each([
    ["oxlint disable", "// oxlint-disable-next-line no-console\n"],
    ["block-comment ESLint disable", "/* eslint-disable no-console */\n"],
    ["bare-separator disable", "// eslint-disable-line no-console --\n"],
    ["Stryker disable", "// Stryker disable next-line all\n"],
  ])("refuses a reasonless %s, naming the directive rule", (_what, directive) => {
    const output = lint.output(holding(directive));

    expect(output).toContain("gives no reason");
    expect(output).toContain(tag("COMMENT", "3"));
  });

  it.each([
    ["an oxlint disable", "// oxlint-disable-next-line no-console -- the runner prints\n"],
    ["a disable in a block", "/* eslint-disable no-console -- the runner prints */\n"],
    ["a Stryker disable", "// Stryker disable next-line all: the fixture is the oracle\n"],
    ["a type-checker escape", "// @ts-expect-error the fixture is the wrong shape\n"],
  ])("walks past %s with its reason", (_what, directive) => {
    expect(lint.flagged(holding(directive))).toEqual([]);
  });

  it.each([
    ["an oxlint disable", `// oxlint-disable-next-line no-console -- ${wordsOf(26)}\n`],
    ["a Stryker disable", `// Stryker disable next-line all: ${wordsOf(26)}\n`],
    ["a type-checker escape", `// @ts-expect-error ${wordsOf(26)}\n`],
  ])("refuses %s's 26-word reason, naming the count", (_what, directive) => {
    const output = lint.output(holding(directive));

    expect(output).toContain("reason runs to 26 words");
    expect(output).toContain(tag("COMMENT", "3"));
  });

  it.each([
    ["a disable", "oxlint-disable-next-line"],
    ["an enable", "oxlint-enable"],
  ])("walks past %s whose reason is exactly 25 words", (_what, directive) => {
    expect(lint.flagged(holding(`// ${directive} no-console -- ${wordsOf(25)}\n`))).toEqual([]);
  });

  it("refuses an enable whose reason runs over 25 words", () => {
    const directive = `// oxlint-enable no-console -- ${wordsOf(26)}\n`;

    expect(lint.output(holding(directive))).toContain("reason runs to 26 words");
  });

  it("counts only the reason, never the rules a disable names", () => {
    const rules = Array.from({ length: 30 }, (_unused, index) => `rule-${String(index)}`).join(
      ", ",
    );

    expect(lint.flagged(holding(`// oxlint-disable ${rules} -- the runner prints\n`))).toEqual([]);
  });

  it("refuses a reason citing a ticket", () => {
    const directive = "// @ts-expect-error the fixture is the wrong shape for T-243\n";

    expect(lint.output(holding(directive))).toContain("cites a ticket id");
  });
});

describe("the comment rule allows an exported function a longer block", () => {
  const inCore = (source: string, file = CORE): Tree => ({ [file]: source });

  it.each([
    ["an arrow function", "export const wait = (count: number): number => count;\n"],
    [
      "a function expression",
      "export const wait = function (count: number): number {\n  return count;\n};\n",
    ],
    [
      "a function declaration",
      "export function wait(count: number): number {\n  return count;\n}\n",
    ],
    [
      "an async function",
      "export async function wait(count: number): Promise<number> {\n  return count;\n}\n",
    ],
    [
      "a default function",
      "export default function wait(count: number): number {\n  return count;\n}\n",
    ],
    ["a default arrow", "export default (count: number): number => count;\n"],
    [
      "an overload's signature",
      "export function wait(count: number): number;\nexport function wait(count: number): number {\n  return count;\n}\n",
    ],
  ])("walks past 50 words on %s in packages/core", (_what, code) => {
    expect(lint.flagged(inCore(`/** ${wordsOf(50)} */\n${code}`))).toEqual([]);
  });

  it("walks past a 50-word block on an export in packages/schema", () => {
    const schema = "packages/schema/src/probe.ts";
    const source = `/** ${wordsOf(50)} */\nexport const wait = (count: number): number => count;\n`;

    expect(lint.flagged(inCore(source, schema))).toEqual([]);
  });

  it("refuses a 51-word export block, naming the 50-word ceiling", () => {
    const source = `/** ${wordsOf(51)} */\nexport const wait = (count: number): number => count;\n`;
    const output = lint.output(inCore(source));

    expect(output).toContain("runs to 51 words");
    expect(output).toContain("in 50 at most");
  });

  it.each([
    ["an exported value", "export const limit = 50;\n"],
    ["a value-and-function export", "export const limit = 50, wait = (): number => 1;\n"],
    [
      "an internal function",
      "const wait = (count: number): number => count;\nexport const keep = wait(1);\n",
    ],
    ["an exported type", "export type Wait = number;\n"],
    ["an uninitialised export", "export let later: number | undefined;\n"],
    ["a re-export of a function", "export { wait } from './wait.ts';\n"],
  ])("refuses a 26-word block on %s", (_what, code) => {
    expect(lint.output(inCore(`/** ${wordsOf(26)} */\n${code}`))).toContain("runs to 26 words");
  });

  it("refuses 26 words of line comments on an exported function", () => {
    const lines = `// ${wordsOf(13)}\n// ${wordsOf(13)}\n`;
    const source = `${lines}export const wait = (count: number): number => count;\n`;

    expect(lint.flagged(inCore(source))).toEqual([CORE]);
  });

  it("refuses a 26-word plain block comment on an exported function", () => {
    const source = `/* ${wordsOf(26)} */\nexport const wait = (count: number): number => count;\n`;

    expect(lint.flagged(inCore(source))).toEqual([CORE]);
  });

  it.each([
    ["outside both packages", "apps/api/src/probe.ts"],
    ["in package tests", "packages/core/test/probe.ts"],
  ])("refuses 26 words on an exported function %s", (_where, file) => {
    const source = `/** ${wordsOf(26)} */\nexport const wait = (count: number): number => count;\n`;

    expect(lint.flagged(inCore(source, file))).toEqual([file]);
  });

  it("gives the longer ceiling only to the export's own block", () => {
    const source = `/** ${wordsOf(26)} */\nconst limit = 1;\n/** short */\nexport const wait = (count: number): number => count + limit;\n`;

    expect(lint.flagged(inCore(source))).toEqual([CORE]);
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

    expect(after).not.toContain(wordsOf(29));
    expect(after).toContain("export const keep = 1;");
  });

  it("leaves a directive alone", () => {
    const directive = "// oxlint-disable-next-line no-console -- the runner prints\n";
    const after = fixed(holding(`${directive}${TOO_LONG}`));

    expect(after).toContain("oxlint-disable-next-line no-console");
    expect(after).not.toContain(wordsOf(29));
  });

  it("removes every line of a run of touching line comments", () => {
    const after = fixed(holding(`// ${wordsOf(9)}\n// ${wordsOf(9)}\n// ${wordsOf(9)}\n`));

    expect(after).toBe("\nexport const keep = 1;\n");
  });
});
