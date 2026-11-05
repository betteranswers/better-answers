import { describe, expect, it } from "vitest";

import { weakestTrust, type Trust } from "../../src/concepts/trust.ts";

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

  it("names the longest ago verification among equals", () => {
    const earlier = verifiedBy("2026-03-01T09:00:00Z");
    const later = verifiedBy("2026-05-12T09:00:00Z");

    expect(weakestTrust([later, earlier])).toEqual(earlier);
    expect(weakestTrust([earlier, later])).toEqual(earlier);
  });
});
