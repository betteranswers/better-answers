import { describe, expect, it } from "vitest";

import { ruleBaseline } from "./rule-baseline.ts";

const OFF_THE_LIST = "packages/core/src/probe.ts";

/** Plain JavaScript, so one fixture parses in a `.ts`, a `.tsx` and an `.mjs` file alike. */
const ofComplexity = (complexity: number): string => {
  const branches = Array.from(
    { length: complexity - 1 },
    (_unused, index) => `  if (value === ${String(index)}) return ${String(index)};\n`,
  ).join("");
  return `export const decide = (value) => {\n${branches}  return -1;\n};\n`;
};

const baseline = ruleBaseline("complexity", {
  tree: { [OFF_THE_LIST]: ofComplexity(9) },
  flagged: [OFF_THE_LIST],
});

describe("the complexity cap holds every function to 8", () => {
  it.each([
    ["an unlisted source file", OFF_THE_LIST],
    ["an unlisted test", "packages/core/test/probe.test.ts"],
    ["an unlisted component", "apps/web/src/shared/ui/probe.tsx"],
    ["an unlisted root script", "scripts/probe.mjs"],
  ])("refuses a function of 9 in %s", (_what, file) => {
    expect(baseline.refusedFiles({ [file]: ofComplexity(9) })).toEqual([file]);
  });

  it("accepts a function of 8 in an unlisted file", () => {
    expect(baseline.refusedFiles({ [OFF_THE_LIST]: ofComplexity(8) })).toEqual([]);
  });

  it("accepts a function of 9 in a listed file", () => {
    const file = baseline.onTheList();

    expect(baseline.refusedFiles({ [file]: ofComplexity(9) })).toEqual([]);
  });
});

describe("the baseline list names only files still over the cap", () => {
  it("names only files the tree still has", () => {
    expect(
      baseline.gone(),
      "a listed file was moved or deleted: drop its line from the list.",
    ).toEqual([]);
  });

  it("names only files holding a function over 8", () => {
    expect(
      baseline.cleared(),
      "a listed file holds no function over 8 any more: drop its line from the list, which only shrinks.",
    ).toEqual([]);
  });
});
