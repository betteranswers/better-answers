// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const skillPath = ".claude/skills/browser-suite/SKILL.md";

const NAMED_PATH = /`(?<file>apps\/[\w./-]+\.(?:tsx?|json))`/g;

const skill = readFileSync(path.join(repositoryRoot, skillPath), "utf8");
const named = [...skill.matchAll(NAMED_PATH)].map((match) => match.groups?.["file"] ?? "");

describe("the browser-suite skill (T-071)", () => {
  it("points at files that are in the tree", () => {
    const missing = [...new Set(named)].filter(
      (file) => !existsSync(path.join(repositoryRoot, file)),
    );
    expect(missing, `${skillPath} names files that do not exist`).toEqual([]);
  });

  it("names the suite's own modules, so the check above has something to hold", () => {
    expect(named).toEqual(
      expect.arrayContaining([
        "apps/web/e2e/browser.ts",
        "apps/web/e2e/harness.ts",
        "apps/web/playwright.config.ts",
        "apps/api/tests/serve.ts",
      ]),
    );
  });
});
