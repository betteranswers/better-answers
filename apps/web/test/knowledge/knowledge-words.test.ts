import { describe, expect, it } from "vitest";

import { KNOWLEDGE_BASE_WORDS } from "@/features/knowledge/knowledge-words.ts";
import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { EMPTY_WORDS } from "@/shared/knowledge/concept-words.ts";

describe("the Knowledge Base's words", () => {
  it("heads a type with no collection as No collection", () => {
    expect(KNOWLEDGE_BASE_WORDS.conceptTypeIn("Policy", null)).toBe(
      `Policy, ${EMPTY_WORDS.collection}`,
    );
    expect(KNOWLEDGE_BASE_WORDS.conceptTypeIn("Policy", "hr")).toBe(
      `Policy in ${collectionNameOf("hr")}`,
    );
  });
});
