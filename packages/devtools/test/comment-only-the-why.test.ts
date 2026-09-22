import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { executableOf, oxlintOver, writeUnder } from "@better-answers/devtools/throwaway-tree";
import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { describe, expect, it } from "vitest";

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
