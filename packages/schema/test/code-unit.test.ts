import { describe, expect, it } from "vitest";

import { byCodeUnit } from "@better-answers/schema/code-unit";

const MIXED = ["b", "B", "a-b", "a_b", "A", "a", "ä", "10", "9", "", "a"];

describe("byCodeUnit", () => {
  it("orders strings as sort() with no comparator does", () => {
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

  it("returns zero for two equal strings", () => {
    expect(byCodeUnit("a", "a")).toBe(0);
  });
});
