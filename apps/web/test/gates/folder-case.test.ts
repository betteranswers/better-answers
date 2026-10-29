import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { workspaceRoot } from "@test/roots.ts";

const source = path.resolve(workspaceRoot, "src");

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const foldersUnder = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const here = path.join(directory, entry.name);
      return [path.relative(source, here), ...foldersUnder(here)];
    });

describe("the SPA's folders", () => {
  it("names every source folder in kebab-case, whatever the filesystem", () => {
    const folders = foldersUnder(source);

    expect(folders.length).toBeGreaterThan(0);
    expect(folders.filter((folder) => !KEBAB_CASE.test(path.basename(folder)))).toEqual([]);
  });
});
