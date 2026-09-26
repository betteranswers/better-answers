// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  askedTooOften,
  tooManyCodesAskedFor,
  tooManyCodesTried,
} from "@/features/auth/refusal-words.ts";

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

const CODE_CEILINGS = [
  ["asked for", tooManyCodesAskedFor],
  ["tried", tooManyCodesTried],
] as const;

describe("the wait a code past its ceiling names", () => {
  it.each(CODE_CEILINGS)("names the carried wait for codes %s, rounded up", (_, said) => {
    expect(said(61).next).toContain(" 2 minutes.");
  });

  it.each(CODE_CEILINGS)("names no time for codes %s without a wait", (_, said) => {
    expect(said(undefined).next).not.toMatch(/\d/);
  });
});
