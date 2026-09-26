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
    { where: "leading", title: "should refuse a long name" },
    { where: "capitalised", title: "Should refuse a long name" },
    { where: "mid-phrase", title: "refuses what it should not take" },
  ])("refuses the forbidden word, $where", ({ title }) => {
    expect(refused(title)).toEqual([OFF_THE_LIST]);
  });

  it("accepts a 10-word title", () => {
    expect(refused(TEN_WORDS)).toEqual([]);
  });
});
