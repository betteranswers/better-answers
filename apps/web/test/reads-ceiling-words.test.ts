// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readsCeiling } from "@/features/knowledge/refusal-words.ts";

describe("what a knowledge read past a ceiling says", () => {
  it("names the wait, rounded up", () => {
    expect(readsCeiling(61).next).toContain(" 2 minutes.");
  });

  // The person's own ceiling and their address's answer alike, so the page cannot know whose it met.
  it("never says whose asking met the ceiling", () => {
    expect(readsCeiling(60).why).not.toMatch(/\byou\b/i);
  });
});
