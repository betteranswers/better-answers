import { describe, expect, it } from "vitest";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";

import { tag, wordsOf } from "./fixture-text.ts";
import { fixedByOxlint } from "./oxlint-fix.ts";

const DOC_BLOCK_RULE = "better-answers/declaration-doc-block";
const WHY_RULE = "better-answers/comment-only-the-why";
const FILE = "probe.ts";

const holding = (source: string): Readonly<Record<string, string>> => ({ [FILE]: source });

const docBlockLint = oxlintOver(pluginConfigFor({ [DOC_BLOCK_RULE]: "error" }), {
  tree: holding("// Kept short.\nexport const keep = 1;\n"),
  flagged: [FILE],
});

const whyLint = oxlintOver(pluginConfigFor({ [WHY_RULE]: "error" }), {
  tree: holding(`// ${wordsOf(26)}\nexport const keep = 1;\n`),
  flagged: [FILE],
});

describe("the doc-block rule fires on a declaration's line comment", () => {
  it("names the form to write and the rule it holds", () => {
    const output = docBlockLint.output(holding("// Kept short.\nexport const keep = 1;\n"));

    expect(output).toContain("`/** */`");
    expect(output).toContain(tag("COMMENT", "1"));
    expect(output).toContain("better-answers(declaration-doc-block)");
  });

  it.each([
    ["an exported const", "export const keep = 1;\n"],
    ["an internal const", "const keep = 1;\nexport default keep;\n"],
    ["a function", "function keep(): number {\n  return 1;\n}\nexport default keep;\n"],
    ["a class", "export class Keep {}\n"],
    ["a type alias", "export type Keep = number;\n"],
    ["an interface", "export interface Keep {\n  readonly one: number;\n}\n"],
    ["an enum", "export enum Keep {\n  One,\n}\n"],
    ["a default export", "export default 1;\n"],
    ["a re-export", "export { join } from 'node:path';\n"],
    ["a star re-export", "export * from 'node:path';\n"],
  ])("refuses a line comment on %s", (_what, code) => {
    expect(docBlockLint.flagged(holding(`// Kept short.\n${code}`))).toEqual([FILE]);
  });

  it("refuses a run of touching line comments as one finding", () => {
    const output = docBlockLint.output(holding("// One.\n// Two.\nexport const keep = 1;\n"));

    expect(output.match(/declaration-doc-block/g)).toHaveLength(1);
  });

  it("refuses a run under a notice, which binds no line", () => {
    const source = "// SPDX-License-Identifier: MIT\n// Kept short.\nexport const keep = 1;\n";

    expect(docBlockLint.flagged(holding(source))).toEqual([FILE]);
  });
});

describe("the doc-block rule stays silent off a declaration", () => {
  it.each([
    ["a doc block", "/** Kept short. */\nexport const keep = 1;\n"],
    ["a plain block comment", "/* Kept short. */\nexport const keep = 1;\n"],
    ["a comment a blank line above", "// Kept short.\n\nexport const keep = 1;\n"],
    ["a trailing comment", "export const one = 1; // Kept short.\nexport const two = 2;\n"],
    [
      "a comment over an import",
      "// Kept short.\nimport { join } from 'node:path';\nexport { join };\n",
    ],
    [
      "a comment over a statement",
      "export const all: number[] = [];\n// Kept short.\nall.push(1);\n",
    ],
    [
      "a comment in a function body",
      "export const keep = (): number => {\n  // Kept short.\n  const one = 1;\n  return one;\n};\n",
    ],
    [
      "a comment in a call's argument",
      "export const keep = [1].map(\n  // Kept short.\n  (one) => one,\n);\n",
    ],
    [
      "a directive",
      "// oxlint-disable-next-line no-console -- the runner prints\nexport const keep = 1;\n",
    ],
    [
      "a type-checker escape",
      "// @ts-expect-error the fixture is the wrong shape\nexport const keep: number = '1';\n",
    ],
    [
      "a run under a type-checker escape",
      "// @ts-expect-error the fixture is the wrong shape\n// Kept short.\nexport const keep: number = '1';\n",
    ],
    ["a notice", "// SPDX-License-Identifier: MIT\nexport const keep = 1;\n"],
    ["a triple-slash reference", '/// <reference types="node" />\nexport const keep = 1;\n'],
  ])("walks past %s", (_what, source) => {
    expect(docBlockLint.flagged(holding(source))).toEqual([]);
  });
});

describe("the doc-block rule's fix", () => {
  const fixed = (source: string, rules: Readonly<Record<string, string>>, exit = 0): string =>
    fixedByOxlint(pluginConfigFor(rules), holding(source), FILE, exit);

  const byItself = { [DOC_BLOCK_RULE]: "error" };

  it("writes one line as a one-line doc block", () => {
    expect(fixed("// Kept short.\nexport const keep = 1;\n", byItself)).toBe(
      "/** Kept short. */\nexport const keep = 1;\n",
    );
  });

  it("writes a run of lines as a starred doc block", () => {
    const source = "// One.\n//\n//   two, indented.\nexport const keep = 1;\n";

    expect(fixed(source, byItself)).toBe(
      "/**\n * One.\n *\n *   two, indented.\n */\nexport const keep = 1;\n",
    );
  });

  it("drops the extra slashes of a triple-slash line", () => {
    expect(fixed("/// Kept short.\nexport const keep = 1;\n", byItself)).toBe(
      "/** Kept short. */\nexport const keep = 1;\n",
    );
  });

  it("converts only the run touching the declaration", () => {
    const source = "// Apart.\n\n// Kept short.\nexport const keep = 1;\n";

    expect(fixed(source, byItself)).toBe(
      "// Apart.\n\n/** Kept short. */\nexport const keep = 1;\n",
    );
  });

  it("reports but leaves a comment that would close early", () => {
    const source = "// Matches */ in a path.\nexport const keep = 1;\n";

    expect(fixed(source, byItself, 1)).toBe(source);
  });

  it("writes a block the comment rule then passes", () => {
    const source = `// ${wordsOf(12)}\n// ${wordsOf(12)}\nexport const keep = 1;\n`;
    const after = fixed(source, { [DOC_BLOCK_RULE]: "error", [WHY_RULE]: "error" });

    expect(after).toContain("/**\n");
    expect(docBlockLint.flagged(holding(after))).toEqual([]);
    expect(whyLint.flagged(holding(after))).toEqual([]);
  });
});
