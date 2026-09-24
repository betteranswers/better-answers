import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { readOxlintConfig, repositoryRoot } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "complexity";

const config = readOxlintConfig();

const baseline = config.overrides.flatMap((override) => {
  const setting = override.rules?.[RULE];
  return setting === undefined ? [] : [{ files: override.files ?? [], rules: { [RULE]: setting } }];
});

const LISTED = baseline.flatMap((override) => override.files);

/** Read off the root config, so a cap it raises, softens or stops exempting fails here. */
const CONFIG = JSON.stringify({ rules: { [RULE]: config.rules[RULE] }, overrides: baseline });

const OFF_THE_LIST = "packages/core/src/probe.ts";

/** Plain JavaScript, so one fixture parses in a `.ts`, a `.tsx` and an `.mjs` file alike. */
const ofComplexity = (complexity: number): string => {
  const branches = Array.from(
    { length: complexity - 1 },
    (_unused, index) => `  if (value === ${String(index)}) return ${String(index)};\n`,
  ).join("");
  return `export const decide = (value) => {\n${branches}  return -1;\n};\n`;
};

const lint = oxlintOver(CONFIG, {
  tree: { [OFF_THE_LIST]: ofComplexity(9) },
  flagged: [OFF_THE_LIST],
});

const REFUSED = new RegExp(`^(?<file>[^\\s:]+):\\d+:\\d+: .*\\[Error/eslint\\(${RULE}\\)\\]$`);

const refusedFiles = (tree: Tree): readonly string[] =>
  [
    ...new Set(
      lint
        .output(tree)
        .split("\n")
        .flatMap((line) => REFUSED.exec(line)?.groups?.["file"] ?? []),
    ),
  ].sort();

describe("the complexity cap holds every function to 8", () => {
  it.each([
    ["an unlisted source file", OFF_THE_LIST],
    ["an unlisted test", "packages/core/test/probe.test.ts"],
    ["an unlisted component", "apps/web/src/shared/ui/probe.tsx"],
    ["an unlisted root script", "scripts/probe.mjs"],
  ])("refuses a function of 9 in %s", (_what, file) => {
    expect(refusedFiles({ [file]: ofComplexity(9) })).toEqual([file]);
  });

  it("accepts a function of 8 in an unlisted file", () => {
    expect(lint.flagged({ [OFF_THE_LIST]: ofComplexity(8) })).toEqual([]);
  });

  it("accepts a function of 9 in a listed file", () => {
    const [onTheList] = LISTED;
    expect(
      onTheList,
      "the baseline list is empty: delete its override from .oxlintrc.json and this case with it.",
    ).toBeDefined();

    expect(lint.flagged({ [onTheList ?? ""]: ofComplexity(9) })).toEqual([]);
  });
});

describe("the baseline list names only files still over the cap", () => {
  const present = (file: string): boolean => existsSync(path.join(repositoryRoot, file));

  it("names only files the tree still has", () => {
    const gone = LISTED.filter((file) => !present(file));

    expect(gone, "a listed file was moved or deleted: drop its line from the list.").toEqual([]);
  });

  it("names only files holding a function over 8", () => {
    const moved = (file: string): string => path.posix.join("unlisted", file);
    const kept = LISTED.filter(present);
    const tree = Object.fromEntries(
      kept.map((file) => [moved(file), readFileSync(path.join(repositoryRoot, file), "utf8")]),
    );
    const refused = refusedFiles(tree);
    const underTheCap = kept.filter((file) => !refused.includes(moved(file)));

    expect(
      underTheCap,
      "a listed file holds no function over 8 any more: drop its line from the list, which only shrinks.",
    ).toEqual([]);
  });
});
