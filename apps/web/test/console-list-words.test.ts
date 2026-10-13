// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  EVERYONE_WORDS,
  NAMES_WAITING_WORDS,
  WORKSPACES_WORDS,
} from "@/features/console/list-words.ts";

/** A count's line with its number taken out: what is left is the form the number chose. */
const formOf = (said: string): string => said.replaceAll(/\d+/g, "");

const LISTS = [
  ["people", EVERYONE_WORDS],
  ["names", NAMES_WAITING_WORDS],
  ["workspaces", WORKSPACES_WORDS],
] as const;

describe("a console list's count", () => {
  it.each(LISTS)("shows how many %s there are", (_, words) => {
    expect(words.counted(1)).toMatch(/\b1\b/);
    expect(words.counted(2)).toMatch(/\b2\b/);
  });

  it.each(LISTS)("gives one of the %s a form of its own", (_, words) => {
    expect(formOf(words.counted(1))).not.toBe(formOf(words.counted(2)));
    expect(formOf(words.counted(2))).toBe(formOf(words.counted(3)));
  });

  it("gives no name waiting a form of its own", () => {
    const none = formOf(NAMES_WAITING_WORDS.counted(0));

    expect(none).not.toBe(formOf(NAMES_WAITING_WORDS.counted(1)));
    expect(none).not.toBe(formOf(NAMES_WAITING_WORDS.counted(2)));
  });

  it("counts each list in its own noun", () => {
    for (const count of [1, 2]) {
      const lines = LISTS.map(([, words]) => words.counted(count));
      expect(new Set(lines).size).toBe(LISTS.length);
    }
  });
});

describe("what a console list's search left", () => {
  it.each(LISTS)("shows how many %s match, and the search", (_, words) => {
    expect(words.matching(1, "priya")).toMatch(/\b1\b/);
    expect(words.matching(2, "priya")).toMatch(/\b2\b/);
    for (const count of [0, 1, 2]) expect(words.matching(count, "priya")).toContain("priya");
  });

  it.each(LISTS)("gives one of the %s matching its own form", (_, words) => {
    expect(formOf(words.matching(1, "priya"))).not.toBe(formOf(words.matching(2, "priya")));
    expect(formOf(words.matching(1, "priya"))).not.toBe(formOf(words.matching(0, "priya")));
    expect(formOf(words.matching(2, "priya"))).toBe(formOf(words.matching(3, "priya")));
  });

  it("says what matches in each list's own noun", () => {
    for (const count of [1, 2]) {
      const lines = LISTS.map(([, words]) => words.matching(count, "priya"));
      expect(new Set(lines).size).toBe(LISTS.length);
    }
  });
});
