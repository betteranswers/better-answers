// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  codeWrong,
  saidOfASecondFactorRefusal,
  tooManyCodesTriedOr,
  type OtherWay,
} from "@/features/auth/refusal-words.ts";
import { refusalSentence, STOCK } from "@/shared/refusal-words.ts";

/** What every wrong-code sentence opens with, read up to the count of tries. */
const wrongCodeLead = (): string => codeWrong(2).split(/\d/)[0] ?? "";

describe("what a refused sign-in code says", () => {
  it.each([2, 1])("names %i left of the code's tries", (left) => {
    expect(codeWrong(left).match(/\d+/g)).toEqual([String(left)]);
  });

  it("says a code with no tries left expired, not wrong", () => {
    const spent = codeWrong(0);

    expect(spent).not.toMatch(/\d/);
    expect(wrongCodeLead()).not.toBe("");
    expect(codeWrong(1).startsWith(wrongCodeLead())).toBe(true);
    expect(spent.startsWith(wrongCodeLead())).toBe(false);
  });
});

const WAYS_HELD: readonly (readonly OtherWay[])[] = [
  [],
  ["passkey"],
  ["recovery-code"],
  ["passkey", "recovery-code"],
];

describe("the wait a throttled code field names", () => {
  it("names the carried wait in whole minutes, rounded up", () => {
    expect(tooManyCodesTriedOr(61, ["passkey"]).match(/\d+/g)).toEqual(["2"]);
  });

  it("names no time without a wait", () => {
    expect(tooManyCodesTriedOr(undefined, ["passkey"])).not.toMatch(/\d/);
  });

  it("says something different for each set of other ways", () => {
    const sentences = WAYS_HELD.map((others) => tooManyCodesTriedOr(60, others));

    expect(new Set(sentences).size).toBe(WAYS_HELD.length);
  });
});

describe("a second-factor action refused after a workspace switch", () => {
  it("shows the switch's own sentence, never its class's", () => {
    const sentence = saidOfASecondFactorRefusal({ word: "workspace-switched", class: "conflict" });

    expect(sentence).toBe(refusalSentence({}, "workspace-switched", "conflict"));
    expect(sentence).not.toBe(STOCK.changed);
  });
});
