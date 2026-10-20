import { describe, expect, it } from "vitest";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

import { COUNTED, NOT_COUNTED, commented } from "./caller-counts.ts";
import { wordsOf } from "./fixture-text.ts";
import { fixedByOxlint } from "./oxlint-fix.ts";

const RULE = "better-answers/comment-only-the-why";
const FILE = "probe.ts";

const CONFIG = pluginConfigFor({ [RULE]: "error" });

const holding = (comment: string, code = "export const keep = 1;\n"): Tree => ({
  [FILE]: `${comment}${code}`,
});

/** Split so vitest does not read this suite's own environment off the fixture. */
const ENVIRONMENT_DOCBLOCK = `/** @vitest-${"environment"} happy-dom */\n`;

const TOO_LONG = `// ${wordsOf(29)}\n`;

const COUNTING = "// Two specs open a member and remove one.\n";

const lint = oxlintOver(CONFIG, { tree: holding(TOO_LONG), flagged: [FILE] });

describe("the comment rule fires on a long or citing comment", () => {
  it("refuses a long block, naming its count and the fix", () => {
    const output = lint.output(holding(TOO_LONG));

    expect(output).toContain("runs to 29 words");
    expect(output).toContain(
      "A comment stays only for a constraint outside this repository (a library, platform or protocol), a public contract, a generated-file marker, a license, or a suppression's reason.",
    );
    expect(output).toContain(
      "Any other comment is deleted: hold its reason in a name, a type, a test, a grant or a lint, or report it open in the tracker.",
    );
    expect(output).toContain("better-answers(comment-only-the-why)");
  });

  it.each([
    ["a ticket id", "// Kept because the claim protocol changed under T-243.\n"],
    ["an ADR number", "// Kept because the map is Postgres under ADR 0021.\n"],
    ["a rule tag", "// Kept because a raw insert lives in a factory ([TEST4]).\n"],
    ["a tag from a digit-bearing family", "// Kept because the outcome is announced ([A11Y1]).\n"],
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
      "page.tsx": `export const Page = () => (\n  <div>{/* ${wordsOf(29)} */}</div>\n);\n`,
    };

    expect(lint.flagged(tsx)).toEqual(["page.tsx"]);
  });
});

describe("the comment rule refuses a comment that counts its callers", () => {
  it("refuses a comment counting its specs, naming the fix", () => {
    const output = lint.output(holding(COUNTING));

    expect(output).toContain("This comment counts the code that uses it (`Two specs`).");
    expect(output).toContain(
      "Delete it: hold a reason the callers share in a name or a test title.",
    );
  });

  it.each(COUNTED)("quotes the count of %s on one line", (_what, prose, counted) => {
    expect(lint.output(holding(commented("//", prose)))).toContain(`uses it (\`${counted}\`).`);
  });

  it.each(NOT_COUNTED)("walks past %s", (_what, prose) => {
    expect(lint.flagged(holding(commented("//", prose)))).toEqual([]);
  });

  it("refuses a doc block counting its callers", () => {
    expect(lint.flagged(holding("/** Both callers hand the trimmed name. */\n"))).toEqual([FILE]);
  });

  it("walks past a doc block naming the one caller", () => {
    expect(lint.flagged(holding("/** The one caller hands the trimmed name. */\n"))).toEqual([]);
  });

  it("refuses a directive's reason that counts its callers", () => {
    const directive = "// @ts-expect-error both callers hand the wrong shape\n";

    expect(lint.output(holding(directive))).toContain("counts the code that uses it");
  });

  it("reports a long count once, for the count", () => {
    const output = lint.output(holding(`// ${wordsOf(26)} for both callers\n`));

    expect(output).toContain("counts the code that uses it (`both callers`)");
    expect(output.match(/better-answers\(comment-only-the-why\)/g)).toHaveLength(1);
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
  ])("refuses a reasonless %s, naming the fix", (_what, directive) => {
    const output = lint.output(holding(directive));

    expect(output).toContain("gives no reason");
    expect(output).toContain("say why on the same line");
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
    expect(output).toContain("Say the constraint alone.");
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

describe("the comment rule gives a doc block no longer cap", () => {
  it.each([
    ["an export in packages/core", "packages/core/src/probe.ts"],
    ["an export in packages/schema", "packages/schema/src/probe.ts"],
    ["an export in apps/api", "apps/api/src/probe.ts"],
  ])("refuses a 26-word doc block on %s", (_where, file) => {
    const source = `/** ${wordsOf(26)} */\nexport const wait = (count: number): number => count;\n`;

    expect(lint.flagged({ [file]: source })).toEqual([file]);
  });
});

describe("the rule's fix", () => {
  const fixed = (tree: Tree): string => fixedByOxlint(CONFIG, tree, FILE);

  it("removes the offending comment and leaves the code", () => {
    const after = fixed(holding(TOO_LONG));

    expect(after).not.toContain(wordsOf(29));
    expect(after).toContain("export const keep = 1;");
  });

  it("removes a comment that counts its callers", () => {
    const after = fixed(holding(COUNTING));

    expect(after).not.toContain("Two specs");
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
