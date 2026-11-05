import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import { saveBriefInput } from "../../src/guides/index.ts";

const input = { writeUpId: ulid(), markdown: "Words.", base: 2 };

const LIMIT = 20_000;

describe("the input of a Brief save", () => {
  it("takes a Brief of exactly 20,000 characters", () => {
    expect(saveBriefInput.safeParse({ ...input, markdown: "a".repeat(LIMIT) }).success).toBe(true);
  });

  it("refuses a Brief past 20,000 characters", () => {
    expect(saveBriefInput.safeParse({ ...input, markdown: "a".repeat(LIMIT + 1) }).success).toBe(
      false,
    );
  });

  it("takes an empty Brief", () => {
    expect(saveBriefInput.safeParse({ ...input, markdown: "" }).success).toBe(true);
  });

  it("refuses a field it does not name", () => {
    expect(saveBriefInput.safeParse({ ...input, includes: [] }).success).toBe(false);
  });

  it("refuses a save naming no version to build on", () => {
    expect(saveBriefInput.safeParse({ ...input, base: 0 }).success).toBe(false);
  });

  it("refuses a save naming no write-up", () => {
    expect(saveBriefInput.safeParse({ ...input, writeUpId: "not-an-id" }).success).toBe(false);
  });
});
