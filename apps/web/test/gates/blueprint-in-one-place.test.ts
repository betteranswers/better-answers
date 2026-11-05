import { describe, expect, it } from "vitest";

import { sourceFiles } from "@test/source-files.ts";

const files = sourceFiles(/\.tsx?$/);

const filesMatching = (pattern: RegExp): readonly string[] =>
  files.filter(({ text }) => pattern.test(text)).map(({ file }) => file);

describe("blueprint styling", () => {
  it("applies the card surface class only in the Card component", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(filesMatching(/\bbg-card\b/)).toEqual(["shared/ui/card.tsx"]);
  });

  it("applies marks and grid patterns only in blueprint parts", () => {
    expect(filesMatching(/data-(?:marks|grid-pattern|dot-pattern)\b/).toSorted()).toEqual([
      "shared/blueprint.tsx",
      "shared/ui/button.tsx",
      "shared/ui/card.tsx",
    ]);
  });
});
