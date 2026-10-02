import { describe, expect, it } from "vitest";

import { EMAIL_ADDRESS } from "@better-answers/schema/email-address";

const takes = (text: string): boolean => EMAIL_ADDRESS.safeParse(text).success;

const run = (length: number): string => "b".repeat(length);

const LONG_LABELS = `${run(63)}.${run(63)}.${run(63)}`;

describe("EMAIL_ADDRESS", () => {
  it("takes a plain address", () => {
    expect(takes("ana@example.com")).toBe(true);
  });

  it("refuses text with no @", () => {
    expect(takes("not-an-address")).toBe(false);
  });

  it("takes an address of 254 characters", () => {
    const address = `a@${LONG_LABELS}.${run(56)}.com`;
    expect(address).toHaveLength(254);
    expect(takes(address)).toBe(true);
  });

  it("refuses an address of 255 characters", () => {
    const address = `a@${LONG_LABELS}.${run(57)}.com`;
    expect(address).toHaveLength(255);
    expect(takes(address)).toBe(false);
  });

  it("takes a local part of 64 characters", () => {
    expect(takes(`${"a".repeat(64)}@example.com`)).toBe(true);
  });

  it("refuses a local part of 65 characters", () => {
    expect(takes(`${"a".repeat(65)}@example.com`)).toBe(false);
  });

  it("takes a domain label of 63 characters", () => {
    expect(takes(`a@${run(63)}.com`)).toBe(true);
  });

  it("refuses a domain label of 64 characters", () => {
    expect(takes(`a@${run(64)}.com`)).toBe(false);
  });
});
