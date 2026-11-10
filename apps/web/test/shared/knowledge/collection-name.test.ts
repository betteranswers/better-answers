import { describe, expect, it } from "vitest";

import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";

describe("a collection's display name", () => {
  it.each([
    ["sectors", "Sectors"],
    ["multi-academy-trusts", "Multi academy trusts"],
    ["bid_library", "Bid library"],
    ["Corporate", "Corporate"],
    ["a", "A"],
  ])("shows %s as %s", (slug, name) => {
    expect(collectionNameOf(slug)).toBe(name);
  });

  it("keeps a name with no letters as it is", () => {
    expect(collectionNameOf("2026")).toBe("2026");
  });
});
