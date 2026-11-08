import { describe, expect, it } from "vitest";

import {
  descriptionOf,
  generatedOf,
  otherFieldsOf,
  READ_KEYS,
  staleAfterOf,
  tagsOf,
  titleOf,
} from "@/shared/knowledge/concept-frontmatter.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";

describe("concept frontmatter parsing", () => {
  it("uses the untitled label when the title is missing", () => {
    expect(titleOf({ type: "Answer" })).toBe(CONCEPT_WORDS.untitled);
    expect(titleOf({ type: "Answer", title: "  " })).toBe(CONCEPT_WORDS.untitled);
    expect(titleOf({ type: "Answer", title: "Audit Logs Retention" })).toBe("Audit Logs Retention");
  });

  it("returns the kind and tags unchanged", () => {
    expect(tagsOf({ type: "Answer", tags: ["audit", "retention"] })).toEqual([
      "audit",
      "retention",
    ]);
    expect(tagsOf({ type: "Answer", tags: "audit" })).toEqual([]);
  });

  it("reads the description and the review date as written text", () => {
    expect(descriptionOf({ description: " How long logs are kept. " })).toBe(
      "How long logs are kept.",
    );
    expect(descriptionOf({ type: "Answer" })).toBeUndefined();
    expect(staleAfterOf({ stale_after: "2026-09-03" })).toBe("2026-09-03");
    expect(staleAfterOf({ stale_after: 20_260_903 })).toBeUndefined();
    expect(staleAfterOf({ type: "Answer" })).toBeUndefined();
  });
});

describe("the generation of a concept", () => {
  it("is the first entry of the list the platform writes", () => {
    expect(
      generatedOf({
        generated: [
          { by: "okf-extract/0.4", at: "2026-02-10" },
          { by: "okf-extract/0.5", at: "2026-03-01" },
        ],
      }),
    ).toEqual({ by: "okf-extract/0.4", at: "2026-02-10" });
  });

  it("is also a plain object", () => {
    const frontmatter: Parameters<typeof generatedOf>[0] = {};
    Object.assign(frontmatter, { generated: { by: "human:01JBZ6Q2V7Y9K3M5N8P0R2T4W6" } });

    expect(generatedOf(frontmatter)).toEqual({ by: "human:01JBZ6Q2V7Y9K3M5N8P0R2T4W6" });
  });

  it("is absent when the file names no actor", () => {
    expect(generatedOf({ type: "Answer" })).toBeUndefined();
    expect(generatedOf({ generated: [] })).toBeUndefined();
    expect(generatedOf({ generated: [{ at: "2026-02-10" }] })).toBeUndefined();
    expect(generatedOf({ generated: "okf-extract/0.4" })).toBeUndefined();
  });

  it("keeps the actor when the day is not text", () => {
    expect(generatedOf({ generated: [{ by: "okf-extract/0.4", at: 20_260_210 }] })).toEqual({
      by: "okf-extract/0.4",
    });
  });
});

describe("the other fields of a concept", () => {
  it("lists only the keys the page does not read", () => {
    const fields = otherFieldsOf({
      type: "Answer",
      title: "Audit Logs Retention",
      description: "How long audit logs are kept.",
      tags: ["audit"],
      iri: "https://better-answers.com/c/01JBZ6Q2V7Y9K3M5N8P0R2T4W6",
      sources: [{ id: "a", resource: "Records policy", locator: "p.4" }],
      verified: [{ by: "human:01JBZ6Q2V7Y9K3M5N8P0R2T4W6", at: "2026-03-03T09:41:00Z" }],
      status: "stable",
      stale_after: "2027-03-03",
      generated: [{ by: "extractor/1", at: "2026-01-01T00:00:00Z" }],
      owners: ["Compliance", "Security"],
      reviewed: true,
      bid_reference: "NB-2026-014",
    });

    expect(fields).toEqual([
      ["owners", "Compliance, Security"],
      ["reviewed", "true"],
      ["bid_reference", "NB-2026-014"],
    ]);
  });

  it.each(READ_KEYS)("leaves %s out, because the page reads it", (key) => {
    expect(otherFieldsOf({ [key]: "x" })).toEqual([]);
  });

  it("shows any other value as compact JSON", () => {
    expect(
      otherFieldsOf({
        contacts: [{ team: "Bids", phone: "0113 496 0000" }],
        paused: null,
        approvers: [],
        sites: 3,
      }),
    ).toEqual([
      ["contacts", '[{"team":"Bids","phone":"0113 496 0000"}]'],
      ["paused", "null"],
      ["approvers", "[]"],
      ["sites", "3"],
    ]);
  });
});
