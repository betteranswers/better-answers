import { describe, expect, it } from "vitest";

import { sourceFiles } from "./source-files.ts";

const files = sourceFiles(/\.tsx?$/);

const writing = (pattern: RegExp): readonly string[] =>
  files.filter(({ text }) => pattern.test(text)).map(({ file }) => file);

describe("the blueprint's parts", () => {
  it("draws a card's surface in the card alone", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(writing(/\bbg-card\b/)).toEqual(["shared/ui/card.tsx"]);
  });

  it("registers objects and lays textures through the parts alone", () => {
    expect(writing(/data-(?:marks|grid-pattern|dot-pattern)\b/).toSorted()).toEqual([
      "shared/blueprint.tsx",
      "shared/ui/button.tsx",
      "shared/ui/card.tsx",
    ]);
  });
});
