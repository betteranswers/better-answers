import { describe, expect, it } from "vitest";

import { INVENTED_MEMBERS, inventedMemberAddress } from "@better-answers/schema/test-workspace";

describe("the test workspace's invented members", () => {
  it("numbers an address from 01, on the domain given", () => {
    expect(inventedMemberAddress(1, "journeys.example")).toBe(
      "invented-member-01@journeys.example",
    );
    expect(inventedMemberAddress(51, "journeys.example")).toBe(
      "invented-member-51@journeys.example",
    );
  });

  it("holds enough members for three pages of 25", () => {
    expect(INVENTED_MEMBERS).toBe(51);
  });
});
