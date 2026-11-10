import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { rootsOf } from "@better-answers/schema/testing/roots";

const { workspaceRoot } = rootsOf(import.meta.url);

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
  it("names every source folder in kebab-case", () => {
    const folders = foldersUnder(source);

    expect(folders.length).toBeGreaterThan(0);
    expect(folders.filter((folder) => !KEBAB_CASE.test(path.basename(folder)))).toEqual([]);
  });
});
