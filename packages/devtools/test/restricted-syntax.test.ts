import { pluginConfigFor, readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

import { tag } from "./fixture-text.ts";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "eslint-js/no-restricted-syntax";

const setting = readOxlintConfig().rules[RULE];
if (setting === undefined) {
  throw new Error(`.oxlintrc.json's base rules block no longer switches ${RULE} on.`);
}

const FILE = "src/probe.ts";

const holding = (body: string): Tree => ({
  [FILE]: `export const REFUSALS = { gone: 1 };\nexport const refusals = { gone: 1 };\nexport const holder = { REFUSALS };\n\nexport const probe = (key: string): unknown => {\n${body}\n};\n`,
});

const IN_TABLE = holding("  return key in REFUSALS;");

const lint = oxlintOver(pluginConfigFor({ [RULE]: setting }), {
  tree: IN_TABLE,
  flagged: [FILE],
});

describe("the syntax the lint refuses, with what to write instead", () => {
  it.each([
    ["`in` over an upper-case table", IN_TABLE, "Object.hasOwn", tag("TYPES", "10")],
    [
      "a `for…in` loop",
      holding("  for (const name in refusals) return name;\n  return key;"),
      "for…of",
      tag("TYPES", "10"),
    ],
    [
      "a labelled statement",
      holding(
        "  outer: for (const name of [key]) {\n    if (name) break outer;\n  }\n  return key;",
      ),
      "return from it",
      tag("DESIGN", "7"),
    ],
  ])("refuses %s, naming its rule", (_shape, tree, instead, rule) => {
    const findings = lint
      .output(tree)
      .split("\n")
      .filter((line) => line.startsWith(`${FILE}:`));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("eslint-js(no-restricted-syntax)");
    expect(findings[0]).toContain(instead);
    expect(findings[0]).toContain(rule);
  });

  it.each([
    ["`in` over a lower-case table", "  return key in refusals;"],
    ["`in` over a member access", "  return key in holder.REFUSALS;"],
    ["`Object.hasOwn` over the table", "  return Object.hasOwn(REFUSALS, key);"],
    ["a `for…of` loop", "  for (const name of Object.keys(REFUSALS)) return name;\n  return key;"],
  ])("stays silent on %s", (_shape, body) => {
    expect(lint.flagged(holding(body))).toEqual([]);
  });
});
