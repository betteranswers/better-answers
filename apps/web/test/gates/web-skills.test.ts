// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { rootsOf } from "@better-answers/schema/testing/roots";

import { EVERY_AREA, pagesOf } from "@/shared/navigation.ts";

const { repositoryRoot } = rootsOf(import.meta.url);

const verifyDirectory = ".claude/skills/verify";
const specsDirectory = ".claude/skills/playwright-specs";
const featuresDirectory = `${verifyDirectory}/features`;
const suiteDirectory = "apps/web/e2e";

const NAMED_PATH = /`(?<file>apps\/[\w./-]+\.(?:tsx?|json))`/g;
const EXPORTED_NAME = /^export (?:async )?(?:function|const|class) (?<name>\w+)/gm;
const TABLE_ROW_NAME = /^\| `(?<name>\w+)` \|/gm;
const DRIVING_COMMAND =
  /`\.claude\/skills\/verify\/scripts\/(?<command>(?:browse|sign-in)\.sh [^`]+)`/g;
const NAVIGATION = /^browse\.sh <port> (?:open|reload)\b/;
const TEXT_WAIT = /^(?:sign-in\.sh |browse\.sh <port> wait --text )/;
const FUNCTION_WAIT = /^browse\.sh <port> wait --fn "(?<body>[^"]*)"/;
const ADDRESS_OR_LOAD = /\bdocument\.(?:location|URL|documentURI|baseURI|readyState)\b/g;
const PAGE_ACTION =
  /^browse\.sh <port> (?:find|click|dblclick|type|fill|press|keyboard|hover|focus|check|uncheck|select|drag|upload|download|scrollintoview|mouse)\b/;
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
const referencedPaths = [...skills.matchAll(NAMED_PATH)].map(
  (match) => match.groups?.["file"] ?? "",
);

const suiteFiles = filesIn(suiteDirectory).filter((file) => file.endsWith(".ts"));
const specs = suiteFiles.filter((file) => file.endsWith(".spec.ts")).map(read);
const modules = suiteFiles.filter((file) => !file.endsWith(".spec.ts"));

const verifyFrontmatter = read(`${verifyDirectory}/SKILL.md`).split("---")[1] ?? "";

const escaped = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

type DrivingCommand = { readonly command: string; readonly line: number };

const drivingCommands = markdownIn(featuresDirectory).map((file) => {
  const text = read(file);
  const commands: DrivingCommand[] = [...text.matchAll(DRIVING_COMMAND)].map((match) => ({
    command: match.groups?.["command"] ?? "",
    line: text.slice(0, match.index).split("\n").length,
  }));
  return { file, commands };
});

const waitsForContent = (command: string): boolean => {
  const body = FUNCTION_WAIT.exec(command)?.groups?.["body"];
  return (
    TEXT_WAIT.test(command) || /\bdocument\b/.test(body?.replaceAll(ADDRESS_OR_LOAD, "") ?? "")
  );
};

function actionsBeforeContent(file: string, commands: DrivingCommand[]): string[] {
  let opened: string | undefined;
  const acts: string[] = [];
  for (const { command, line } of commands) {
    if (NAVIGATION.test(command)) opened = command;
    else if (waitsForContent(command)) opened = undefined;
    else if (opened !== undefined && PAGE_ACTION.test(command)) {
      acts.push(`${file}:${line}: ${opened} then ${command}`);
      opened = undefined;
    }
  }
  return acts;
}

describe("the verify and playwright-specs skills", () => {
  it("point at files that are in the tree", () => {
    const missing = [...new Set(referencedPaths)].filter(
      (file) => !existsSync(path.join(repositoryRoot, file)),
    );
    expect(missing, "the skills reference files that do not exist").toEqual([]);
  });

  it("name the browser suite's core modules", () => {
    expect(referencedPaths).toEqual(
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
    expect(
      shared.length,
      "found no shared helpers, so the check would pass vacuously",
    ).toBeGreaterThan(0);
    const unnamed = shared.filter(({ name }) => !skills.includes(`\`${name}\``));
    expect(unnamed, "the skills do not document these shared helpers").toEqual([]);
  });

  it("list only helpers the browser suite still exports", () => {
    const exported = new Set(modules.flatMap((module) => namesIn(read(module), EXPORTED_NAME)));
    const rows = namesIn(skills, TABLE_ROW_NAME);
    const stale = rows
      .filter((name) => !exported.has(name))
      .filter((name) => !PLAYWRIGHT_FIXTURES.has(name));
    expect(
      rows.length,
      "found no helper table rows, so the check would pass vacuously",
    ).toBeGreaterThan(0);
    expect(stale, "the skills list helpers the browser suite no longer exports").toEqual([]);
  });

  it("map every navigation page to a feature file", () => {
    const features = markdownIn(featuresDirectory).map(read).join("\n");
    const unmapped = pagesOf(EVERY_AREA)
      .map((page) => page.path)
      .filter((address) => !new RegExp(`${escaped(address)}(?![\\w/-])`).test(features));
    expect(unmapped, `no file under ${featuresDirectory} names these pages`).toEqual([]);
  });

  it("wait for page content before acting after navigation", () => {
    const navigations = drivingCommands.flatMap(({ commands }) =>
      commands.filter(({ command }) => NAVIGATION.test(command)),
    );
    const earlyActions = drivingCommands.flatMap(({ file, commands }) =>
      actionsBeforeContent(file, commands),
    );
    expect(
      navigations.length,
      "found no open or reload commands, so the check would pass vacuously",
    ).toBeGreaterThan(0);
    expect(earlyActions, "these commands act on a page before waiting for its content").toEqual([]);
  });

  it("let the model invoke the verify skill", () => {
    expect(verifyFrontmatter).toMatch(/^name: verify$/m);
    expect(verifyFrontmatter).not.toMatch(/disable-model-invocation/);
  });
});
