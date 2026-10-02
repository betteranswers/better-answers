import { describe, expect, it } from "vitest";

import { EMAIL_ADDRESS } from "@better-answers/schema/email-address";

const takes = (text: string): boolean => EMAIL_ADDRESS.safeParse(text).success;

describe("EMAIL_ADDRESS", () => {
  it("takes a plain address", () => {
    expect(takes("ana@example.com")).toBe(true);
  });

  it("refuses text with no @", () => {
    expect(takes("not-an-address")).toBe(false);
  });

  it("takes an address of 254 characters", () => {
    expect(takes(`a@${"b".repeat(248)}.com`)).toBe(true);
  });

  it("refuses an address of 255 characters", () => {
    expect(takes(`a@${"b".repeat(249)}.com`)).toBe(false);
  });
});
