import { describe, expect, it } from "vitest";

import { markersOf } from "../../src/knowledge/brief-marker.ts";

describe("the markers of a Brief", () => {
  it("lists each marker in order, including repeats", () => {
    expect(markersOf("A[^one] B[^two-2] C[^one]")).toEqual(["one", "two-2", "one"]);
  });

  it("does not read a footnote definition as a marker", () => {
    expect(markersOf("Claim[^a].\n\n[^b]: a definition")).toEqual(["a"]);
  });

  it("finds no marker in prose without a footnote", () => {
    expect(markersOf("Plain words, a [link](x) and [^ spaced].")).toEqual([]);
  });
});
