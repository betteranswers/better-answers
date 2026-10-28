import { beforeAll, describe, expect, it } from "vitest";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintBatchOver } from "@better-answers/devtools/throwaway-tree";
import type { PlannedLint, Tree } from "@better-answers/devtools/throwaway-tree";

import { COUNTED, NOT_COUNTED, commented } from "../support/caller-counts.ts";
import { wordsOf } from "../support/fixture-text.ts";
import { fixedByOxlint } from "../support/oxlint-fix.ts";

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

const batch = oxlintBatchOver();

const lint = (tree: Tree): PlannedLint => batch.plan(tree, CONFIG);

batch.control(holding(TOO_LONG), CONFIG, [FILE]);

beforeAll(batch.run);

describe("the comment rule fires on a long or citing comment", () => {
  const longBlock = lint(holding(TOO_LONG));

  it("refuses a long block, naming its count and the fix", () => {
    const output = longBlock.output();

    expect(output).toContain("runs to 29 words");
    expect(output).toContain(
      "A comment stays only for a constraint outside this repository (a library, platform or protocol), a public contract, a generated-file marker, a license, or a suppression's reason.",
    );
    expect(output).toContain(
      "Any other comment is deleted: hold its reason in a name, a type, a test, a grant or a lint, or report it open in the tracker.",
    );
    expect(output).toContain("better-answers(comment-only-the-why)");
  });

  it.each(
    (
      [
        ["a ticket id", "// Kept because the claim protocol changed under T-243.\n"],
        ["an ADR number", "// Kept because the map is Postgres under ADR 0021.\n"],
        ["a rule tag", "// Kept because a raw insert lives in a factory ([TEST4]).\n"],
        [
          "a tag from a digit-bearing family",
          "// Kept because the outcome is announced ([A11Y1]).\n",
        ],
        ["an ISO date", "// Kept because the reading of the registry moved on 2026-09-21.\n"],
        ["a slashed date", "// Kept because the reading of the registry moved on 21/09/2026.\n"],
      ] as const
    ).map(([what, comment]) => [what, lint(holding(comment))] as const),
  )("refuses a comment citing %s", (_what, found) => {
    expect(found.flagged()).toEqual([FILE]);
  });

  const eightShortLines = Array.from({ length: 8 }, () => "// four more words here\n").join("");
  const touching = lint(holding(eightShortLines));

  it("counts a run of touching line comments as one block", () => {
    expect(touching.flagged()).toEqual([FILE]);
  });

  const apart = lint(holding(`// ${wordsOf(20)}\n\n// ${wordsOf(20)}\n`));

  it("counts line comments a blank line apart as two blocks", () => {
    expect(apart.flagged()).toEqual([]);
  });

  it.each(
    (
      [
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
      ] as const
    ).map(([what, source]) => [what, lint(holding(source))] as const),
  )("counts %s separately", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });

  const indented = lint({
    [FILE]: `export const f = (): number => {\n  // ${wordsOf(13)}\n  // ${wordsOf(13)}\n  return 1;\n};\n`,
  });

  it("counts a run of indented line comments as one block", () => {
    expect(indented.flagged()).toEqual([FILE]);
  });

  const docBlock = lint(
    holding(`/**\n${Array.from({ length: 5 }, () => ` * ${wordsOf(5)}\n`).join("")} */\n`),
  );

  it("counts a multi-line doc block's words, never its asterisks", () => {
    expect(docBlock.flagged()).toEqual([]);
  });

  const banner = lint(holding(`/*****\n * ${wordsOf(25)}\n *****/\n`));

  it("counts no words in a banner of asterisks", () => {
    expect(banner.flagged()).toEqual([]);
  });

  const brokenLines = Array.from({ length: 26 }, (_unused, index) => `word${String(index)}\n`).join(
    "",
  );
  const broken = lint(holding(`/*\n${brokenLines}*/\n`));

  it("keeps a block's words apart across its line breaks", () => {
    expect(broken.flagged()).toEqual([FILE]);
  });

  it.each(
    (
      [
        ["an oxlint disable", "the oxlint-disable-next-line form"],
        ["an enable", "the eslint-enable form"],
        ["a Stryker restore", "the Stryker restore form"],
        ["a type-checker escape", "the @ts-expect-error form"],
        ["a notice", "the SPDX-License-Identifier line"],
      ] as const
    ).map(
      ([what, named]) =>
        [
          what,
          lint(holding(`// ${wordsOf(12)}\n// ${named} is named here\n// ${wordsOf(12)}\n`)),
        ] as const,
    ),
  )("reads %s named mid-sentence as prose", (_what, found) => {
    expect(found.flagged(), "prose, never a directive").toEqual([FILE]);
  });

  it.each(
    (
      [
        ["a triple-slash reference", '/// <reference types="node" />'],
        ["a triple-slash reference with no space", '///<reference types="node" />'],
        ["a Stryker restore", "// Stryker restore all"],
        ["a coverage directive", "// v8 ignore next"],
      ] as const
    ).map(
      ([what, notice]) =>
        [what, lint(holding(`// ${wordsOf(20)}\n${notice}\n// ${wordsOf(20)}\n`))] as const,
    ),
  )("ends a block at %s", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });

  const jsx = lint({
    "page.tsx": `export const Page = () => (\n  <div>{/* ${wordsOf(29)} */}</div>\n);\n`,
  });

  it("refuses a comment inside JSX, which the line counter misses", () => {
    expect(jsx.flagged()).toEqual(["page.tsx"]);
  });
});

describe("the comment rule refuses a comment that counts its callers", () => {
  const counting = lint(holding(COUNTING));

  it("refuses a comment counting its specs, naming the fix", () => {
    const output = counting.output();

    expect(output).toContain("This comment counts the code that uses it (`Two specs`).");
    expect(output).toContain(
      "Delete it: hold a reason the callers share in a name or a test title.",
    );
  });

  it.each(
    COUNTED.map(
      ([what, prose, counted]) => [what, counted, lint(holding(commented("//", prose)))] as const,
    ),
  )("quotes the count of %s on one line", (_what, counted, found) => {
    expect(found.output()).toContain(`uses it (\`${counted}\`).`);
  });

  it.each(
    NOT_COUNTED.map(([what, prose]) => [what, lint(holding(commented("//", prose)))] as const),
  )("walks past %s", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });

  const countingDocBlock = lint(holding("/** Both callers hand the trimmed name. */\n"));

  it("refuses a doc block counting its callers", () => {
    expect(countingDocBlock.flagged()).toEqual([FILE]);
  });

  const oneCallerDocBlock = lint(holding("/** The one caller hands the trimmed name. */\n"));

  it("walks past a doc block naming the one caller", () => {
    expect(oneCallerDocBlock.flagged()).toEqual([]);
  });

  const countingDirective = lint(
    holding("// @ts-expect-error both callers hand the wrong shape\n"),
  );

  it("refuses a directive's reason that counts its callers", () => {
    expect(countingDirective.output()).toContain("counts the code that uses it");
  });

  const longCount = lint(holding(`// ${wordsOf(26)} for both callers\n`));

  it("reports a long count once, for the count", () => {
    const output = longCount.output();

    expect(output).toContain("counts the code that uses it (`both callers`)");
    expect(output.match(/better-answers\(comment-only-the-why\)/g)).toHaveLength(1);
  });
});

describe("the comment rule's exemptions", () => {
  it.each(
    (
      [
        ["a why inside the ceiling", "// Deleting this changes what knip answers.\n"],
        ["a why of exactly 25 words", `// ${wordsOf(25)}\n`],
        ["a copy-detection fence", "/* jscpd:ignore-start */\n/* jscpd:ignore-end */\n"],
        ["a test environment docblock", ENVIRONMENT_DOCBLOCK],
        ["a triple-slash reference", '/// <reference types="node" />\n'],
        ["a licence notice", "// SPDX-License-Identifier: MIT\n"],
        ["an enable, which suppresses nothing to explain", "// oxlint-enable no-console\n"],
      ] as const
    ).map(([what, comment]) => [what, lint(holding(comment))] as const),
  )("walks past %s", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });

  const hashbang = lint({ [FILE]: "#!/usr/bin/env node\nexport const keep = 1;\n" });

  it("walks past a hashbang, which deleting would break a command", () => {
    expect(hashbang.flagged()).toEqual([]);
  });

  const both = lint(
    holding(`// oxlint-disable-next-line no-console -- the runner prints\n${TOO_LONG}`),
  );

  it("keeps a directive's exemption off the paragraph under it", () => {
    expect(both.flagged()).toEqual([FILE]);
  });
});

describe("the comment rule holds a directive to a same-line reason", () => {
  it.each(
    (
      [
        ["oxlint disable", "// oxlint-disable-next-line no-console\n"],
        ["block-comment ESLint disable", "/* eslint-disable no-console */\n"],
        ["bare-separator disable", "// eslint-disable-line no-console --\n"],
        ["Stryker disable", "// Stryker disable next-line all\n"],
      ] as const
    ).map(([what, directive]) => [what, lint(holding(directive))] as const),
  )("refuses a reasonless %s, naming the fix", (_what, found) => {
    const output = found.output();

    expect(output).toContain("gives no reason");
    expect(output).toContain("say why on the same line");
  });

  it.each(
    (
      [
        ["an oxlint disable", "// oxlint-disable-next-line no-console -- the runner prints\n"],
        ["a disable in a block", "/* eslint-disable no-console -- the runner prints */\n"],
        ["a Stryker disable", "// Stryker disable next-line all: the fixture is the oracle\n"],
        ["a type-checker escape", "// @ts-expect-error the fixture is the wrong shape\n"],
      ] as const
    ).map(([what, directive]) => [what, lint(holding(directive))] as const),
  )("walks past %s with its reason", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });

  it.each(
    (
      [
        ["an oxlint disable", `// oxlint-disable-next-line no-console -- ${wordsOf(26)}\n`],
        ["a Stryker disable", `// Stryker disable next-line all: ${wordsOf(26)}\n`],
        ["a type-checker escape", `// @ts-expect-error ${wordsOf(26)}\n`],
      ] as const
    ).map(([what, directive]) => [what, lint(holding(directive))] as const),
  )("refuses %s's 26-word reason, naming the count", (_what, found) => {
    const output = found.output();

    expect(output).toContain("reason runs to 26 words");
    expect(output).toContain("Say the constraint alone.");
  });

  it.each(
    (
      [
        ["a disable", "oxlint-disable-next-line"],
        ["an enable", "oxlint-enable"],
      ] as const
    ).map(
      ([what, directive]) =>
        [what, lint(holding(`// ${directive} no-console -- ${wordsOf(25)}\n`))] as const,
    ),
  )("walks past %s whose reason is exactly 25 words", (_what, found) => {
    expect(found.flagged()).toEqual([]);
  });

  const longEnable = lint(holding(`// oxlint-enable no-console -- ${wordsOf(26)}\n`));

  it("refuses an enable whose reason runs over 25 words", () => {
    expect(longEnable.output()).toContain("reason runs to 26 words");
  });

  const rules = Array.from({ length: 30 }, (_unused, index) => `rule-${String(index)}`).join(", ");
  const manyRules = lint(holding(`// oxlint-disable ${rules} -- the runner prints\n`));

  it("counts only the reason, never the rules a disable names", () => {
    expect(manyRules.flagged()).toEqual([]);
  });

  const citingTicket = lint(
    holding("// @ts-expect-error the fixture is the wrong shape for T-243\n"),
  );

  it("refuses a reason citing a ticket", () => {
    expect(citingTicket.output()).toContain("cites a ticket id");
  });
});

describe("the comment rule gives a doc block no longer cap", () => {
  it.each(
    (
      [
        ["an export in packages/core", "packages/core/src/probe.ts"],
        ["an export in packages/schema", "packages/schema/src/probe.ts"],
        ["an export in apps/api", "apps/api/src/probe.ts"],
      ] as const
    ).map(
      ([where, file]) =>
        [
          where,
          file,
          lint({
            [file]: `/** ${wordsOf(26)} */\nexport const wait = (count: number): number => count;\n`,
          }),
        ] as const,
    ),
  )("refuses a 26-word doc block on %s", (_where, file, found) => {
    expect(found.flagged()).toEqual([file]);
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
