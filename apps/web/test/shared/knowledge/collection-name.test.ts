import { describe, expect, it } from "vitest";

import { collectionLabelOf } from "@/shared/knowledge/collection-name.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";

describe("a collection's label where a concept may have none", () => {
  it("names a collection and says when a concept has none", () => {
    expect(collectionLabelOf("multi-academy-trusts")).toBe("Multi academy trusts");
    expect(collectionLabelOf(null)).toBe(CONCEPT_WORDS.noCollection);
    expect(collectionLabelOf(undefined)).toBe(CONCEPT_WORDS.noCollection);
  });
});
