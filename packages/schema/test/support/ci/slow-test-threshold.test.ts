import { describe, expect, it } from "vitest";

import { slowTestThreshold } from "./slow-test-threshold.ts";

describe("the slow-test threshold", () => {
  it("lists only tests over five seconds under GitHub Actions", () => {
    expect(slowTestThreshold({ GITHUB_ACTIONS: "true" })).toBe(5_000);
  });

  it("keeps vitest's 300 ms default outside GitHub Actions", () => {
    expect(slowTestThreshold({})).toBe(300);
  });
});
