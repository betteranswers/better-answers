// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  askedTooOften,
  tooManyCodesAskedFor,
  tooManyCodesTried,
} from "@/features/auth/refusal-words.ts";

describe("the wait an ask past its ceiling names", () => {
  it.each([
    [0, 1],
    [1, 1],
    [60, 1],
    [61, 2],
    [600, 10],
  ])("names %i seconds as %i whole minutes, rounded up", (liftsInSeconds, minutes) => {
    expect(askedTooOften(liftsInSeconds).next.match(/\d+/g)).toEqual([String(minutes)]);
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
