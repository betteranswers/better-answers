// @vitest-environment node

import { describe, expect, it } from "vitest";

import { FEEDBACK_REASONS } from "@better-answers/schema";

import { FLAG_REASONS, REASON_WORDS } from "@/shared/answer-words.ts";

describe("a flag's reasons", () => {
  it("offers each reason the api takes, and no other", () => {
    expect(FLAG_REASONS.toSorted()).toEqual(FEEDBACK_REASONS.toSorted());
    expect(Object.keys(REASON_WORDS).toSorted()).toEqual(FEEDBACK_REASONS.toSorted());
  });
});
