import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const web = path.resolve(import.meta.dirname, "..");

/** Installed, built or left by a run, or the suite, which stubs the key rather than reading it. */
const NOT_SOURCE = new Set(["node_modules", "dist", "test-results", "playwright-report", "test"]);

const filesUnder = (directory: string): readonly string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));

const sourceFiles = (): readonly string[] =>
  readdirSync(web, { withFileTypes: true })
    .filter((entry) => !NOT_SOURCE.has(entry.name))
    .flatMap((entry) => {
      const here = path.join(web, entry.name);
      return entry.isDirectory() ? filesUnder(here) : [here];
    });

describe("the test inbox's key", () => {
  it("is named in the inbox reader and nowhere else", () => {
    const files = sourceFiles();
    const naming = files
      .filter((file) => readFileSync(file, "utf8").includes("JOURNEYS_INBOX_KEY"))
      .map((file) => path.relative(web, file));

    // A walk that missed the journeys would find nothing to hold.
    expect(files.map((file) => path.relative(web, file))).toContain("journeys/fixtures.ts");
    expect(naming).toEqual(["journeys/inbox.ts"]);
  });
});
