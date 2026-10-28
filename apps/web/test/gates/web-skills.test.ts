// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@test/roots.ts";

import { EVERY_AREA, pagesOf } from "@/shared/navigation.ts";

const verifyDirectory = ".claude/skills/verify";
const specsDirectory = "apps/web/.claude/skills/playwright-specs";
const featuresDirectory = `${verifyDirectory}/features`;
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

const markdownIn = (directory: string): string[] =>
  filesIn(directory).filter((file) => file.endsWith(".md"));

const skills = [...markdownIn(verifyDirectory), ...markdownIn(specsDirectory)].map(read).join("\n");
const named = [...skills.matchAll(NAMED_PATH)].map((match) => match.groups?.["file"] ?? "");

const suiteFiles = filesIn(suiteDirectory).filter((file) => file.endsWith(".ts"));
const specs = suiteFiles.filter((file) => file.endsWith(".spec.ts")).map(read);
const modules = suiteFiles.filter((file) => !file.endsWith(".spec.ts"));

const verifyFrontmatter = read(`${verifyDirectory}/SKILL.md`).split("---")[1] ?? "";

const escaped = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("the verify and playwright-specs skills", () => {
  it("point at files that are in the tree", () => {
    const missing = [...new Set(named)].filter(
      (file) => !existsSync(path.join(repositoryRoot, file)),
    );
    expect(missing, "the web's skills name files that do not exist").toEqual([]);
  });

  it("name the suite's own modules, so the check holds something", () => {
    expect(named).toEqual(
      expect.arrayContaining([
        "apps/web/e2e/browser.ts",
        "apps/web/e2e/harness.ts",
        "apps/web/playwright.config.ts",
        "apps/api/tests/serve.ts",
      ]),
    );
  });

  it("name every helper that two or more specs share", () => {
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
    const unnamed = shared.filter(({ name }) => !skills.includes(`\`${name}\``));
    expect(unnamed, "the web's skills leave out helpers the specs share").toEqual([]);
  });

  it("give rows only to helpers the suite still exports", () => {
    const exported = new Set(modules.flatMap((module) => namesIn(read(module), EXPORTED_NAME)));
    const rows = namesIn(skills, TABLE_ROW_NAME);
    const stale = rows
      .filter((name) => !exported.has(name))
      .filter((name) => !PLAYWRIGHT_FIXTURES.has(name));
    expect(rows.length, "no table row was found, so the check holds nothing").toBeGreaterThan(0);
    expect(stale, "the web's skills have rows for helpers the suite no longer exports").toEqual([]);
  });

  it("give every page in the navigation list a feature file", () => {
    const features = markdownIn(featuresDirectory).map(read).join("\n");
    const unmapped = pagesOf(EVERY_AREA)
      .map((page) => page.path)
      .filter((address) => !new RegExp(`${escaped(address)}(?![\\w/-])`).test(features));
    expect(unmapped, `no file under ${featuresDirectory} names these pages`).toEqual([]);
  });

  it("register the verify skill for the model to call", () => {
    expect(verifyFrontmatter).toMatch(/^name: verify$/m);
    expect(verifyFrontmatter).not.toMatch(/disable-model-invocation/);
  });
});
