import { describe, expect, it } from "vitest";

import { byCodeUnit } from "@better-answers/schema/code-unit";

const MIXED = ["b", "B", "a-b", "a_b", "A", "a", "ä", "10", "9", "", "a"];

describe("byCodeUnit", () => {
  it("orders by code unit, as a comparator-less sort does", () => {
    expect(MIXED.toSorted(byCodeUnit)).toEqual([
      "",
      "10",
      "9",
      "A",
      "B",
      "a",
      "a",
      "a-b",
      "a_b",
      "b",
      "ä",
    ]);
  });

  it("puts an upper-case letter before every lower-case one", () => {
    expect(["bar", "Foo"].toSorted(byCodeUnit)).toEqual(["Foo", "bar"]);
  });

  it("holds equal strings equal", () => {
    expect(byCodeUnit("a", "a")).toBe(0);
  });
});
