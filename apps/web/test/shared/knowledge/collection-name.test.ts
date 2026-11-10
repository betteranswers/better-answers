import { describe, expect, it } from "vitest";

import { collectionLabelOf, collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";

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

describe("a collection's label where a concept may have none", () => {
  it("names a collection and says when a concept has none", () => {
    expect(collectionLabelOf("multi-academy-trusts")).toBe("Multi academy trusts");
    expect(collectionLabelOf(null)).toBe(CONCEPT_WORDS.noCollection);
    expect(collectionLabelOf(undefined)).toBe(CONCEPT_WORDS.noCollection);
  });
});
