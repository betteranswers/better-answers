// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EVERY_AREA, pagesOf } from "@/shared/navigation.ts";
import { repositoryRoot } from "@test/roots.ts";

const verifyDirectory = ".claude/skills/verify";
const specsDirectory = "apps/web/.claude/skills/playwright-specs";
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
const named = [...skills.matchAll(NAMED_PATH)].map((match) => match.groups?.["file"] ?? "");

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

const waitsForTheDraw = (command: string): boolean => {
  const body = FUNCTION_WAIT.exec(command)?.groups?.["body"];
  return (
    TEXT_WAIT.test(command) || /\bdocument\b/.test(body?.replaceAll(ADDRESS_OR_LOAD, "") ?? "")
  );
};

function actsBeforeTheDraw(file: string, commands: DrivingCommand[]): string[] {
  let opened: string | undefined;
  const acts: string[] = [];
  for (const { command, line } of commands) {
    if (NAVIGATION.test(command)) opened = command;
    else if (waitsForTheDraw(command)) opened = undefined;
    else if (opened !== undefined && PAGE_ACTION.test(command)) {
      acts.push(`${file}:${line}: ${opened} then ${command}`);
      opened = undefined;
    }
  }
  return acts;
}

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

  it("wait for drawn text before acting after an open", () => {
    const navigations = drivingCommands.flatMap(({ commands }) =>
      commands.filter(({ command }) => NAVIGATION.test(command)),
    );
    const undrawn = drivingCommands.flatMap(({ file, commands }) =>
      actsBeforeTheDraw(file, commands),
    );
    expect(
      navigations.length,
      "no open or reload was found, so the check holds nothing",
    ).toBeGreaterThan(0);
    expect(undrawn, "these act on a page with no wait on its text or its elements").toEqual([]);
  });

  it("register the verify skill for the model to call", () => {
    expect(verifyFrontmatter).toMatch(/^name: verify$/m);
    expect(verifyFrontmatter).not.toMatch(/disable-model-invocation/);
  });
});
