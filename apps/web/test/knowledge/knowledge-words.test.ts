import { describe, expect, it } from "vitest";

import { KNOWLEDGE_BASE_WORDS } from "@/features/knowledge/knowledge-words.ts";

describe("the Knowledge Base's words", () => {
  it("heads a kind with no collection as No collection", () => {
    expect(KNOWLEDGE_BASE_WORDS.kindIn("Policy", null)).toBe("Policy, No collection");
    expect(KNOWLEDGE_BASE_WORDS.kindIn("Policy", "hr")).toBe("Policy in hr");
  });
});
