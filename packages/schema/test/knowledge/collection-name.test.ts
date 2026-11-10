import { describe, expect, it } from "vitest";

import { collectionNameOf, guideTitleOf } from "../../src/knowledge/collection-name.ts";

describe("a guide's title", () => {
  it("is its subject's title, or else its collection's display name", () => {
    expect(guideTitleOf({ collection: "hr", subject: { title: "Northgate Ltd" } })).toBe(
      "Northgate Ltd",
    );
    expect(guideTitleOf({ collection: "multi_academy-trusts", subject: null })).toBe(
      "Multi academy trusts",
    );
  });
});

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

  it.each([
    ["hr", "HR"],
    ["hr-policies", "HR policies"],
    ["gdpr_records", "GDPR records"],
    ["HR", "HR"],
    ["b2b-sales", "B2B sales"],
  ])("writes the acronym in %s in capitals", (slug, name) => {
    expect(collectionNameOf(slug)).toBe(name);
  });
});
