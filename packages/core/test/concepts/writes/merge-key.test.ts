import { describe, expect, it } from "vitest";

import { foldConceptType } from "../../../src/bundle/index.ts";
import { mergeKeyMovedBy } from "../../../src/concepts/writes/merge-key.ts";

describe("the new merge key after an edit", () => {
  const held = { conceptType: "Policy", title: "Mileage Allowance" };

  it("stays unchanged when kind and title differ only in form", () => {
    expect(
      mergeKeyMovedBy(held, { conceptType: "policies", title: "  mileage   ALLOWANCE " }),
    ).toBe(undefined);
  });

  it("moves to the new title, lowercased with spaces collapsed", () => {
    expect(mergeKeyMovedBy(held, { conceptType: "Policy", title: " Mileage  Rates " })).toBe(
      "Policy:mileage rates",
    );
  });

  it("moves to the new kind in its canonical form", () => {
    expect(mergeKeyMovedBy(held, { conceptType: "guidelines", title: "Mileage Allowance" })).toBe(
      "Guideline:mileage allowance",
    );
  });

  it("stays unchanged when given the held kind back", () => {
    const analysis = { conceptType: foldConceptType("Analyses"), title: "Quarterly Margins" };

    expect(mergeKeyMovedBy(analysis, analysis)).toBe(undefined);
  });
});
