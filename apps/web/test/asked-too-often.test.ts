// @vitest-environment node

import { describe, expect, it } from "vitest";

import { askedTooOften } from "@/features/auth/refusal-words.ts";

describe("the wait an ask past its ceiling names", () => {
  it.each([
    [0, "a minute"],
    [1, "a minute"],
    [60, "a minute"],
    [61, "2 minutes"],
    [600, "10 minutes"],
  ])("names %i seconds as %s, rounded up", (liftsInSeconds, wait) => {
    expect(askedTooOften(liftsInSeconds).next).toContain(` ${wait}.`);
  });
});
