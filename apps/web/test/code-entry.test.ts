import { describe, expect, it } from "vitest";

import { digitsOf, triesLeft, worthSending } from "@/features/auth/code-entry.ts";

describe("the code a person enters", () => {
  it.each([
    ["spaced", "123 456", "123456"],
    ["dashed", "123-456", "123456"],
    ["wrapped in words", "Your code: 123456.", "123456"],
    ["in full-width digits", "１２３４５６", "123456"],
    ["with a seventh digit", "1234567", "123456"],
    ["with letters between", "1a2b3c", "123"],
    ["with nothing but letters", "abc", ""],
  ])("reads the digits of a code %s", (_, entered, digits) => {
    expect(digitsOf(entered)).toBe(digits);
  });

  it("sends six digits nobody refused", () => {
    expect(worthSending("123456", [])).toBe(true);
  });

  it.each([
    ["five digits", "12345", []],
    ["nothing", "", []],
    ["a refused value", "123456", ["000000", "123456"]],
  ])("holds back %s", (_, code, refused) => {
    expect(worthSending(code, refused)).toBe(false);
  });

  it("sends a value that differs from the one refused", () => {
    expect(worthSending("123457", ["123456"])).toBe(true);
  });

  it.each([
    [0, 3],
    [1, 2],
    [2, 1],
    [3, 0],
    [4, 0],
  ])("after %i refusals leaves %i tries", (refusals, left) => {
    expect(triesLeft(refusals)).toBe(left);
  });
});
