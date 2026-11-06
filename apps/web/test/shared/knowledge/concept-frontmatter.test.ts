import { describe, expect, it } from "vitest";

import { furtherKeysOf, kindOf, tagsOf, titleOf } from "@/shared/knowledge/concept-frontmatter.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";

describe("concept frontmatter parsing", () => {
  it("uses the untitled label when the title is missing", () => {
    expect(titleOf({ type: "Answer" })).toBe(CONCEPT_WORDS.untitled);
    expect(titleOf({ type: "Answer", title: "  " })).toBe(CONCEPT_WORDS.untitled);
    expect(titleOf({ type: "Answer", title: "Audit Logs Retention" })).toBe("Audit Logs Retention");
  });

  it("returns the kind and tags unchanged", () => {
    expect(kindOf({ type: "Answer" })).toBe("Answer");
    expect(tagsOf({ type: "Answer", tags: ["audit", "retention"] })).toEqual([
      "audit",
      "retention",
    ]);
    expect(tagsOf({ type: "Answer", tags: "audit" })).toEqual([]);
  });

  it("lists only the keys the page does not already show", () => {
    const extraKeys = furtherKeysOf({
      type: "Answer",
      title: "Audit Logs Retention",
      description: "How long audit logs are kept.",
      tags: ["audit"],
      iri: "https://better-answers.com/c/01JBZ6Q2V7Y9K3M5N8P0R2T4W6",
      sources: [{ id: "a", resource: "Records policy", locator: "p.4" }],
      verified: [{ by: "human:01JBZ6Q2V7Y9K3M5N8P0R2T4W6", at: "2026-03-03T09:41:00Z" }],
      status: "stable",
      stale_after: "2027-03-03",
      owners: ["Compliance", "Security"],
      reviewed: true,
      generated: [{ by: "extractor/1", at: "2026-01-01T00:00:00Z" }],
    });

    expect(extraKeys).toEqual([
      ["status", "stable"],
      ["stale_after", "2027-03-03"],
      ["owners", "Compliance, Security"],
      ["reviewed", "true"],
    ]);
  });
});
