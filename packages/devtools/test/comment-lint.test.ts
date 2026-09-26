import { describe, expect, it } from "vitest";

import { loadableAnywhere, readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { lintFlags } from "@better-answers/devtools/root-commands";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

import { tag, wordsOf } from "./fixture-text.ts";

const COMMENT_RULES = [
  "typescript/ban-ts-comment",
  "typescript/prefer-ts-expect-error",
  "eslint/no-warning-comments",
  "unicorn/no-abusive-eslint-disable",
  "better-answers/comment-only-the-why",
  "better-answers/string-cites-nothing",
];

/** A rule a directive can suppress, so a used disable is told apart from an unused one. */
const SUPPRESSIBLE = "no-console";

const config = readOxlintConfig();

/** Each rule at the setting the root config holds it, so a rule it drops or softens fails here. */
const CONFIG = JSON.stringify({
  plugins: config.plugins,
  jsPlugins: config.jsPlugins
    .filter((plugin) => plugin.name === "better-answers")
    .map(loadableAnywhere),
  rules: Object.fromEntries(
    Object.entries(config.rules).filter(
      ([name]) => COMMENT_RULES.includes(name) || name === SUPPRESSIBLE,
    ),
  ),
});

const FILE = "apps/api/src/probe.ts";
const EXPORTED = "packages/core/src/probe.ts";

const holding = (comment: string, code = "export const keep = 1;\n"): Tree => ({
  [FILE]: `${comment}${code}`,
});

const PRINTS = "console.log(1);\n";

const exporting = (block: string): Tree => ({
  [EXPORTED]: `${block}export const waitMs = (count: number): number => count * 1000;\n`,
});

const lint = oxlintOver(
  CONFIG,
  { tree: holding("// TODO: file the ticket\n"), flagged: [FILE] },
  lintFlags(),
);

describe("the one lint config refuses a comment breaking a rule", () => {
  it.each([
    [
      "a 26-word line comment",
      holding(`// ${wordsOf(26)}\n`),
      "better-answers(comment-only-the-why)",
    ],
    ["`@ts-ignore`", holding("// @ts-ignore\n"), "typescript(ban-ts-comment)"],
    [
      "`@ts-ignore`, naming the directive to use",
      holding("// @ts-ignore\n"),
      "typescript(prefer-ts-expect-error)",
    ],
    [
      "`@ts-expect-error` with no reason",
      holding("// @ts-expect-error\n", 'export const keep: number = "one";\n'),
      "typescript(ban-ts-comment)",
    ],
    [
      "a disable with no reason",
      holding(`// oxlint-disable-next-line ${SUPPRESSIBLE}\n`, PRINTS),
      "better-answers(comment-only-the-why)",
    ],
    [
      "a directive reason over 25 words",
      holding(`// oxlint-disable-next-line ${SUPPRESSIBLE} -- ${wordsOf(26)}\n`, PRINTS),
      "better-answers(comment-only-the-why)",
    ],
    ["a TODO", holding("// TODO: file the ticket\n"), "eslint(no-warning-comments)"],
    [
      "a FIXME in a doc block",
      holding("/** FIXME: the count is off by one */\n"),
      "eslint(no-warning-comments)",
    ],
    ["a blanket disable", holding("/* eslint-disable */\n"), "unicorn(no-abusive-eslint-disable)"],
    [
      "a 51-word doc block on an export",
      exporting(`/** ${wordsOf(51)} */\n`),
      "better-answers(comment-only-the-why)",
    ],
    [
      "a string citing a ticket",
      holding("", 'export const usage = "Ask the owner about T-243 first.";\n'),
      "better-answers(string-cites-nothing)",
    ],
  ])("refuses %s at error", (_what, tree, rule) => {
    expect(lint.output(tree)).toContain(`[Error/${rule}]`);
  });

  it("refuses a disable that suppresses nothing at error", () => {
    const output = lint.output(
      holding(`// oxlint-disable-next-line ${SUPPRESSIBLE} -- the runner prints its report\n`),
    );

    expect(output).toMatch(/Unused oxlint-disable directive.*\[Error\]/);
  });

  it("refuses a 26-word block on an internal function beside exports", () => {
    const internal = {
      [EXPORTED]: `/** ${wordsOf(26)} */\nconst halve = (count: number): number => count / 2;\nexport const quarter = (count: number): number => halve(halve(count));\n`,
    };

    expect(lint.output(internal)).toContain("[Error/better-answers(comment-only-the-why)]");
  });

  it("refuses a 26-word export block outside the documented packages", () => {
    const inTheApi = {
      [FILE]: `/** ${wordsOf(26)} */\nexport const waitMs = (count: number): number => count * 1000;\n`,
    };

    expect(lint.flagged(inTheApi)).toEqual([FILE]);
  });

  it("names the directive rule when a disable carries no reason", () => {
    const output = lint.output(holding(`// oxlint-disable-next-line ${SUPPRESSIBLE}\n`, PRINTS));

    expect(output).toContain(tag("COMMENT", "3"));
  });

  it("refuses a 26-word comment in a root script", () => {
    const script = { "scripts/probe.mjs": `// ${wordsOf(26)}\nexport const keep = 1;\n` };

    expect(lint.flagged(script)).toEqual(["scripts/probe.mjs"]);
  });
});

describe("the one lint config accepts a comment keeping the rules", () => {
  it.each([
    ["a 25-word line comment", holding(`// ${wordsOf(25)}\n`)],
    ["a `/** */` on a declaration", holding("/** Deleting this changes what knip answers. */\n")],
    [
      "`@ts-expect-error` with its reason",
      holding(
        "// @ts-expect-error the fixture is deliberately the wrong shape\n",
        'export const keep: number = "one";\n',
      ),
    ],
    [
      "a disable naming its rule and reason, suppressing something",
      holding(
        `// oxlint-disable-next-line ${SUPPRESSIBLE} -- the runner prints its report\n`,
        PRINTS,
      ),
    ],
    [
      "a directive reason of 25 words",
      holding(`// oxlint-disable-next-line ${SUPPRESSIBLE} -- ${wordsOf(25)}\n`, PRINTS),
    ],
    [
      "a comment that mentions a todo list mid-sentence",
      holding("// The todo list stays sorted.\n"),
    ],
    [
      "an export's doc block stating units and the refusal",
      exporting(
        "/** Milliseconds, never negative. Refuses a count over 60 with `too-long`, and `null` means no wait. */\n",
      ),
    ],
    ["a 50-word doc block on an export", exporting(`/** ${wordsOf(50)} */\n`)],
    [
      "a string that names what the reader can do",
      holding("", 'export const usage = "Name a workspace this person belongs to.";\n'),
    ],
  ])("accepts %s", (_what, tree) => {
    expect(lint.flagged(tree)).toEqual([]);
  });
});
