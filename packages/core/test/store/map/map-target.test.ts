import { describe, expect, it } from "vitest";

import { targetOf } from "@better-answers/core/store/map";

describe("the target a link names", () => {
  it("reads a scheme only when its letters are all ASCII", () => {
    expect(targetOf("Ka:b.md", "knowledge/expenses.md")).toEqual({
      path: "knowledge/Ka:b.md",
    });
    expect(targetOf("Ka:b.md", "knowledge/expenses.md")).toBeUndefined();
  });
});
