import { describe, expect, it } from "vitest";

import { sectionAt, sentenceAt } from "@better-answers/core/store/map";
import { linksAndMarksOf, proseOf } from "@better-answers/schema/concept-file";

const takenBy = (work: () => void): number => {
  const started = performance.now();
  work();
  return performance.now() - started;
};

describe("the concept-file reader on worst-case bodies", () => {
  it("parses 100,000 open brackets in under a second", () => {
    const brackets = "[".repeat(100_000);
    const sources = [{ resource: "https://example.test/handbook", locator: null, id: "a" }];

    expect(takenBy(() => proseOf(brackets))).toBeLessThan(1000);
    expect(takenBy(() => linksAndMarksOf(brackets, sources))).toBeLessThan(1000);
  });

  it("finds a sentence in an 80,000-character body within a second", () => {
    const linked = "[a](b)".repeat(10_000) + "[".repeat(20_000);
    const prose = proseOf(linked);

    expect(takenBy(() => sentenceAt(linked, prose, prose.length - 1))).toBeLessThan(1000);
  });

  it("finds the section of an 80,000-space heading within a second", () => {
    const spaced = `# Mileage${" ".repeat(80_000)}rates\n\nSee [the rates](rates.md).`;

    expect(takenBy(() => sectionAt(spaced, spaced.length - 1))).toBeLessThan(1000);
  });
});
