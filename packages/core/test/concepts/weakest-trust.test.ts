import { describe, expect, it } from "vitest";

import { trustOf, trustWords, weakestTrust, type Trust } from "../../src/concepts/trust.ts";

const verifiedBy = (at: string): Trust => ({
  tier: "human-reviewed",
  verifiedBy: "Dana Example",
  verifiedAt: at,
  rider: null,
  status: "current",
});

const MACHINE: Trust = {
  tier: "machine-confirmed",
  verifiedBy: "process:checker",
  verifiedAt: "2026-05-12T09:00:00Z",
  rider: null,
  status: "current",
};

const UNVERIFIED: Trust = {
  tier: "unverified",
  verifiedBy: null,
  verifiedAt: null,
  rider: null,
  status: "current",
};

describe("the trust a section shows", () => {
  it("is unverified when the section cites nothing", () => {
    expect(weakestTrust([])).toEqual(UNVERIFIED);
  });

  it("takes the weakest tier among current concepts", () => {
    expect(weakestTrust([verifiedBy("2026-05-12T09:00:00Z"), MACHINE, UNVERIFIED])).toEqual(
      UNVERIFIED,
    );
    expect(weakestTrust([verifiedBy("2026-05-12T09:00:00Z"), MACHINE])).toEqual(MACHINE);
  });

  it("ranks a changed or out-of-date concept below an unverified one", () => {
    const changed: Trust = {
      ...verifiedBy("2026-05-12T09:00:00Z"),
      status: "changed-since-checked",
    };
    const stale: Trust = { ...UNVERIFIED, status: "out-of-date" };

    expect(weakestTrust([UNVERIFIED, changed])).toEqual(changed);
    expect(weakestTrust([changed, stale, UNVERIFIED])).toEqual(stale);
  });

  it("ranks a draft below a changed concept", () => {
    const changed: Trust = {
      ...verifiedBy("2026-05-12T09:00:00Z"),
      status: "changed-since-checked",
    };
    const draft: Trust = { ...UNVERIFIED, status: "draft" };

    expect(weakestTrust([changed, draft])).toEqual(draft);
  });

  it("ranks a deprecated concept below a draft", () => {
    const draft: Trust = { ...UNVERIFIED, status: "draft" };
    const deprecated: Trust = { ...UNVERIFIED, status: "deprecated" };

    expect(weakestTrust([draft, deprecated])).toEqual(deprecated);
  });

  it("names the oldest verification among equals", () => {
    const earlier = verifiedBy("2026-03-01T09:00:00Z");
    const later = verifiedBy("2026-05-12T09:00:00Z");

    expect(weakestTrust([later, earlier])).toEqual(earlier);
    expect(weakestTrust([earlier, later])).toEqual(earlier);
  });
});

const HASH = "a".repeat(64);

const verifiedConcept = (status: string, frontmatter: Readonly<Record<string, string>> = {}) => ({
  status,
  frontmatter,
  contentHash: HASH,
  verification: {
    actor: "human:01JBZ6Q2V7Y9K3M5N8P0R2T4W6" as const,
    at: new Date("2026-05-12T09:00:00Z"),
    contentHash: HASH,
    verifierName: "Dana Example",
  },
});

describe("a concept's trust status", () => {
  const now = new Date("2026-06-01T09:00:00Z");

  it("reads a verified draft as Draft", () => {
    const trust = trustOf(verifiedConcept("draft"), now);

    expect(trust).toMatchObject({ tier: "human-reviewed", status: "draft" });
    expect(trustWords(trust)).toBe("Draft");
  });

  it("puts out of date before draft", () => {
    expect(trustOf(verifiedConcept("draft", { stale_after: "2026-05-01" }), now).status).toBe(
      "out-of-date",
    );
  });

  it("reads a stable concept as current", () => {
    expect(trustOf(verifiedConcept("stable"), now).status).toBe("current");
  });
});
