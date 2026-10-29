// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@test/roots.ts";

const skillDirectory = ".claude/skills/browser-suite";
const suiteDirectory = "apps/web/e2e";

const NAMED_PATH = /`(?<file>apps\/[\w./-]+\.(?:tsx?|json))`/g;
const EXPORTED_NAME = /^export (?:async )?(?:function|const|class) (?<name>\w+)/gm;
const TABLE_ROW_NAME = /^\| `(?<name>\w+)` \|/gm;
const PLAYWRIGHT_FIXTURES = new Set(["context", "page", "request", "passesTheAccessibilityGate"]);

function filesIn(directory: string): string[] {
  return readdirSync(path.join(repositoryRoot, directory), {
    encoding: "utf8",
    recursive: true,
  }).map((file) => `${directory}/${file}`);
}

const read = (file: string): string => readFileSync(path.join(repositoryRoot, file), "utf8");

const namesIn = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((match) => match.groups?.["name"] ?? "");

const skillFiles = [
  `${skillDirectory}/SKILL.md`,
  ...filesIn(`${skillDirectory}/references`).filter((file) => file.endsWith(".md")),
];
const skill = skillFiles.map(read).join("\n");
const named = [...skill.matchAll(NAMED_PATH)].map((match) => match.groups?.["file"] ?? "");

const suiteFiles = filesIn(suiteDirectory).filter((file) => file.endsWith(".ts"));
const specs = suiteFiles.filter((file) => file.endsWith(".spec.ts")).map(read);
const modules = suiteFiles.filter((file) => !file.endsWith(".spec.ts"));

describe("the browser-suite skill", () => {
  it("points at files that are in the tree", () => {
    const missing = [...new Set(named)].filter(
      (file) => !existsSync(path.join(repositoryRoot, file)),
    );
    expect(missing, `${skillDirectory} names files that do not exist`).toEqual([]);
  });

  it("names the suite's own modules, so the check holds something", () => {
    expect(named).toEqual(
      expect.arrayContaining([
        "apps/web/e2e/browser.ts",
        "apps/web/e2e/harness.ts",
        "apps/web/playwright.config.ts",
        "apps/api/tests/serve.ts",
      ]),
    );
  });

  it("names every helper that two or more specs share", () => {
    const shared = modules.flatMap((module) =>
      namesIn(read(module), EXPORTED_NAME)
        .filter(
          (name) => specs.filter((spec) => new RegExp(`\\b${name}\\b`).test(spec)).length >= 2,
        )
        .map((name) => ({ module, name })),
    );
    expect(shared.length, "no shared helper was found, so the check holds nothing").toBeGreaterThan(
      0,
    );
    const unnamed = shared.filter(({ name }) => !skill.includes(`\`${name}\``));
    expect(unnamed, `${skillDirectory} leaves out helpers the specs share`).toEqual([]);
  });

  it("gives rows only to helpers the suite still exports", () => {
    const exported = new Set(modules.flatMap((module) => namesIn(read(module), EXPORTED_NAME)));
    const rows = namesIn(skill, TABLE_ROW_NAME);
    const stale = rows
      .filter((name) => !exported.has(name))
      .filter((name) => !PLAYWRIGHT_FIXTURES.has(name));
    expect(rows.length, "no table row was found, so the check holds nothing").toBeGreaterThan(0);
    expect(stale, `${skillDirectory} has rows for helpers the suite no longer exports`).toEqual([]);
  });
});
