import { describe, expect, it } from "vitest";

import { slowTestThreshold } from "./slow-test-threshold.ts";

describe("the slow-test threshold", () => {
  it("lists no test as slow under GitHub Actions", () => {
    expect(slowTestThreshold({ GITHUB_ACTIONS: "true" })).toBe(Infinity);
  });

  it("keeps vitest's 300 ms outside GitHub Actions", () => {
    expect(slowTestThreshold({})).toBe(300);
  });
});
