// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The browser-suite skill names files, and a document that names files is a document that
 * rots (`[CHECK1]`: a gate is run, not remembered). The next session reads it instead of the
 * suite, so a path that has moved sends that session to a file that is not there — the one
 * failure a skill cannot survive, because nothing else in the run would notice.
 *
 * What this reads is the skill's backticked paths under `apps/`, which is every file it
 * points at; a bare word or a command argument is prose and is deliberately not followed.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const skillPath = ".claude/skills/browser-suite/SKILL.md";

/** A backticked path into a workspace: `apps/…` ending in a source or manifest extension. */
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

  // Without this the check above passes for a skill that names nothing at all — the silent
  // pass `[CHECK2]` refuses everywhere else.
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
