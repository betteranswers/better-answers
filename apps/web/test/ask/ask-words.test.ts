import { describe, expect, it } from "vitest";

import { ASK_WORDS } from "@/features/ask/ask-words.ts";

describe("Ask's words", () => {
  it("names a group with no collection as No collection", () => {
    expect(ASK_WORDS.noCollection).toBe("No collection");
  });
});
