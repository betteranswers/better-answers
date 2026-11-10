import { describe, expect, it } from "vitest";

import { currentOf } from "@/features/knowledge/guides/outline/current-section.ts";

describe("the section being read", () => {
  it("is the first until a heading reaches the top", () => {
    expect(currentOf([240, 800, 1500], 100, false)).toBe(0);
  });

  it("is the last section whose heading has reached the top", () => {
    expect(currentOf([-900, -300, 60, 700], 100, false)).toBe(2);
  });

  it("is the last section once the page ends", () => {
    expect(currentOf([-900, -300, 400], 100, true)).toBe(2);
  });

  it("is the first when the guide has no section", () => {
    expect(currentOf([], 100, false)).toBe(0);
  });
});
