import { describe, expect, it } from "vitest";

import { leavesAFactUnmet } from "../../src/guides/write-ups.ts";

const FACTS = [
  { id: "public-liability", atLeast: 1 },
  { id: "filed-accounts", atLeast: 2 },
];

describe("the unmet mark on a seeded write-up", () => {
  it("marks a write-up whose fact has too few includes", () => {
    expect(
      leavesAFactUnmet(FACTS, [
        { expectedFactId: "public-liability" },
        { expectedFactId: "filed-accounts" },
      ]),
    ).toBe(true);
  });

  it("leaves a write-up unmarked once every fact reaches its minimum", () => {
    expect(
      leavesAFactUnmet(FACTS, [
        { expectedFactId: "public-liability" },
        { expectedFactId: "filed-accounts" },
        { expectedFactId: "filed-accounts" },
      ]),
    ).toBe(false);
  });

  it("counts an include only toward its own expected fact", () => {
    expect(
      leavesAFactUnmet(FACTS, [
        { expectedFactId: "filed-accounts" },
        { expectedFactId: "filed-accounts" },
        { expectedFactId: null },
      ]),
    ).toBe(true);
  });

  it("leaves a write-up that expects no fact unmarked", () => {
    expect(leavesAFactUnmet([], [])).toBe(false);
  });
});
