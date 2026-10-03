import { describe, expect, it } from "vitest";

import { TEST_INBOX_MESSAGE, TEST_INBOX_PAGE } from "@better-answers/schema/test-inbox";

const LISTED = {
  id: "0001791000000000-0123456789abcdef",
  to: ["admin@journeys.example"],
  from: "Better Answers <sign-in@better-answers.example>",
  created_at: "2026-10-03T04:00:00.000Z",
  subject: "",
};

describe("the test inbox's contract", () => {
  it("reads a list whose recipients are an array", () => {
    expect(TEST_INBOX_PAGE.safeParse({ object: "list", has_more: false, data: [LISTED] })).toEqual({
      success: true,
      data: { object: "list", has_more: false, data: [LISTED] },
    });
  });

  it("refuses a listed message whose recipient is one string", () => {
    const page = { has_more: false, data: [{ ...LISTED, to: "admin@journeys.example" }] };

    expect(TEST_INBOX_PAGE.safeParse(page).success).toBe(false);
  });

  it("reads raw bytes in base64, and refuses anything else", () => {
    expect(TEST_INBOX_MESSAGE.safeParse({ ...LISTED, raw: "NDgyOTEzDQo=" }).success).toBe(true);
    expect(TEST_INBOX_MESSAGE.safeParse({ ...LISTED, raw: "482913\r\n" }).success).toBe(false);
  });
});
