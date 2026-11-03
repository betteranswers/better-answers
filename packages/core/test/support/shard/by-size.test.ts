import { describe, expect, it } from "vitest";

import { dealBySize } from "./by-size.ts";

const files = [
  { id: "a", size: 90 },
  { id: "b", size: 50 },
  { id: "c", size: 40 },
  { id: "d", size: 30 },
  { id: "e", size: 20 },
];

describe("dealBySize", () => {
  it("gives every file to exactly one shard", () => {
    const dealt = dealBySize(files, 2).flat().toSorted();

    expect(dealt).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("evens the bytes of the shards", () => {
    expect(dealBySize(files, 2)).toEqual([
      ["a", "d"],
      ["b", "c", "e"],
    ]);
  });

  it("deals the same way whatever order the files come in", () => {
    expect(dealBySize(files.toReversed(), 2)).toEqual(dealBySize(files, 2));
  });

  it("leaves a shard empty when the files are fewer", () => {
    expect(dealBySize([{ id: "a", size: 1 }], 2)).toEqual([["a"], []]);
  });
});
