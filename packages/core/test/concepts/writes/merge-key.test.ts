import { describe, expect, it } from "vitest";

import { mergeKeyMovedBy } from "../../../src/concepts/writes/merge-key.ts";

describe("the merge key an edit moves to", () => {
  const held = { kind: "Policy", title: "Mileage Allowance" };

  it("stays put while the folded kind and loose title stand", () => {
    expect(mergeKeyMovedBy(held, { kind: "policies", title: "  mileage   ALLOWANCE " })).toBe(
      undefined,
    );
  });

  it("moves to the retitled key, lowered with spaces collapsed", () => {
    expect(mergeKeyMovedBy(held, { kind: "Policy", title: " Mileage  Rates " })).toBe(
      "Policy:mileage rates",
    );
  });

  it("moves to the rekinded key under the folded kind", () => {
    expect(mergeKeyMovedBy(held, { kind: "guidelines", title: "Mileage Allowance" })).toBe(
      "Guideline:mileage allowance",
    );
  });
});
