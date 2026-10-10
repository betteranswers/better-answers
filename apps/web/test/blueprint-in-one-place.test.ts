import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = path.resolve(import.meta.dirname, "../src");

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const here = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(here);
    return /\.tsx?$/.test(entry.name) ? [path.relative(source, here)] : [];
  });

const files = sourceFiles(source).map((file) => ({
  file,
  text: readFileSync(path.join(source, file), "utf8"),
}));

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
