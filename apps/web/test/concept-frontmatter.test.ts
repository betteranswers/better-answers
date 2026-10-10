import { describe, expect, it } from "vitest";

import {
  dayOf,
  furtherKeysOf,
  kindOf,
  tagsOf,
  titleOf,
  verifiedEventsOf,
} from "@/features/knowledge/concept-frontmatter.ts";

describe("what a concept page reads from a file's frontmatter", () => {
  it("names a file with no title as untitled", () => {
    expect(titleOf({ type: "Answer" })).toBe("Untitled concept");
    expect(titleOf({ type: "Answer", title: "  " })).toBe("Untitled concept");
    expect(titleOf({ type: "Answer", title: "Audit Logs Retention" })).toBe("Audit Logs Retention");
  });

  it("reads the kind and tags as the file wrote them", () => {
    expect(kindOf({ type: "Answer" })).toBe("Answer");
    expect(tagsOf({ type: "Answer", tags: ["audit", "retention"] })).toEqual([
      "audit",
      "retention",
    ]);
    expect(tagsOf({ type: "Answer", tags: "audit" })).toEqual([]);
  });

  it("says a verifier is a person or not, never who", () => {
    const events = verifiedEventsOf({
      type: "Answer",
      verified: [
        { by: "human:01JBZ6Q2V7Y9K3M5N8P0R2T4W6", at: "2026-03-03T09:41:00Z" },
        { by: "process:records-checker", at: "2026-04-01T08:00:00Z" },
      ],
    });

    expect(events).toEqual([
      { at: "2026-03-03T09:41:00Z", byAPerson: true },
      { at: "2026-04-01T08:00:00Z", byAPerson: false },
    ]);
  });

  it("says an event's day in the UK long form", () => {
    expect(dayOf({ at: "2026-03-03T09:41:00Z", byAPerson: true })).toBe("3 March 2026");
  });

  it("shows an unreadable date as the file wrote it", () => {
    expect(dayOf({ at: "last Tuesday", byAPerson: false })).toBe("last Tuesday");
  });

  it("reads a malformed verified list as no events", () => {
    expect(verifiedEventsOf({ type: "Answer", verified: "yesterday" })).toEqual([]);
    expect(verifiedEventsOf({ type: "Answer", verified: [{ by: "human:x" }] })).toEqual([]);
  });

  it("lists the keys no part of the page already draws", () => {
    const further = furtherKeysOf({
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

    expect(further).toEqual([
      ["status", "stable"],
      ["stale_after", "2027-03-03"],
      ["owners", "Compliance, Security"],
      ["reviewed", "true"],
    ]);
  });
});
