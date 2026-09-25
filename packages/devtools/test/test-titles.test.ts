import { describe, expect, it } from "vitest";

import { ruleBaseline } from "./rule-baseline.ts";

const OFF_THE_LIST = "packages/core/test/probe.test.ts";

const TEN_WORDS = "refuses a name over one hundred characters for every member";
const ELEVEN_WORDS = "refuses a name over one hundred characters for every workspace member";

const titled = (title: string, callee = "it"): string =>
  `import { expect, ${callee} } from "vitest";\n\n${callee}(${JSON.stringify(title)}, () => {\n  expect(1).toBe(1);\n});\n`;

const baseline = ruleBaseline("vitest/valid-title", {
  tree: { [OFF_THE_LIST]: titled(ELEVEN_WORDS) },
  flagged: [OFF_THE_LIST],
});

const refused = (title: string, callee?: string): readonly string[] =>
  baseline.refusedFiles({ [OFF_THE_LIST]: titled(title, callee) });

describe("the test-title rule", () => {
  it.each(["describe", "it", "test"])("refuses an 11-word title passed to %s", (callee) => {
    expect(refused(ELEVEN_WORDS, callee)).toEqual([OFF_THE_LIST]);
  });

  it.each([
    "should refuse a long name",
    "Should refuse a long name",
    "refuses what it should not take",
  ])("refuses %j", (title) => {
    expect(refused(title)).toEqual([OFF_THE_LIST]);
  });

  it("accepts a 10-word title", () => {
    expect(refused(TEN_WORDS)).toEqual([]);
  });

  it("accepts an 11-word title in a listed file", () => {
    const file = baseline.onTheList();

    expect(baseline.refusedFiles({ [file]: titled(ELEVEN_WORDS) })).toEqual([]);
  });

  it("keeps the stock title checks in a listed file", () => {
    const file = baseline.onTheList();

    expect(baseline.refusedFiles({ [file]: titled("") })).toEqual([file]);
  });
});

describe("the test-title baseline", () => {
  it("names only files the tree still has", () => {
    expect(
      baseline.gone(),
      "a listed file was moved or deleted: drop its line from the list.",
    ).toEqual([]);
  });

  it("names only files holding a title the rule refuses", () => {
    expect(
      baseline.cleared(),
      "a listed file holds no refused title any more: drop its line from the list, which only shrinks.",
    ).toEqual([]);
  });
});
