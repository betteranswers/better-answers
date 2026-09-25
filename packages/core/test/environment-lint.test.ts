import { readFileSync } from "node:fs";
import path from "node:path";

import { readOxlintConfig, repositoryRoot } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

const RULE = "node/no-process-env";
const SEVERITY = "error";

const config = readOxlintConfig();

const excused = config.overrides.filter((override) => override.rules?.[RULE] === "off");

const READS_A_SETTING = `export const dsn = process.env["DATABASE_URL"] ?? "";\n`;

const SOURCE = "packages/core/src/concepts/landing.ts";

const lint = oxlintOver(
  JSON.stringify({
    plugins: config.plugins,
    rules: { [RULE]: SEVERITY },
    overrides: excused.map((override) => ({ files: override.files, rules: { [RULE]: "off" } })),
  }),
  { tree: { [SOURCE]: READS_A_SETTING }, flagged: [SOURCE] },
);

describe("the environment lint fires on a setting read in source", () => {
  it.each([
    ["a slice of the business logic", SOURCE],
    ["a store door", "packages/core/src/store/postgres/index.ts"],
    ["the api's server", "apps/api/src/server.ts"],
    ["an api transport", "apps/api/src/trpc/router.ts"],
    ["the SPA's entry", "apps/web/src/main.tsx"],
    ["a screen under a feature", "apps/web/src/features/auth/sign-in-screen.tsx"],
    ["a shared package", "packages/schema/src/concept-tables.ts"],
  ])("%s", (_what, file) => {
    expect(lint.flagged({ [file]: READS_A_SETTING })).toEqual([file]);
  });
});

const EXCUSED: readonly (readonly [string, string])[] = [
  ["the api's config module", "apps/api/src/config.ts"],
  ["the browser suite's configuration", "apps/web/playwright.config.ts"],
  ["the git store door's pass-through", "packages/core/src/store/git/index.ts"],
  ["a repository script", "scripts/check.mjs"],
  ["the gate tooling", "packages/devtools/src/throwaway-tree.ts"],
  ["a test", "packages/core/test/git.test.ts"],
  ["a test that renders", "apps/web/test/frame.test.tsx"],
  ["a test helper beside it", "packages/core/test/bundle.ts"],
  ["a suite under a plural directory", "apps/api/tests/image-probe.ts"],
  ["a browser spec", "apps/web/e2e/routes.spec.ts"],
];

describe("the environment lint passes where a read is deliberate", () => {
  it.each(EXCUSED)("%s", (_what, file) => {
    expect(lint.flagged({ [file]: READS_A_SETTING })).toEqual([]);
  });
});

/**
 * Without this control a silence above would read as an excuse, when it could as easily be a
 * file extension the linter never opened.
 */
const unexcused = oxlintOver(
  JSON.stringify({ plugins: config.plugins, rules: { [RULE]: SEVERITY } }),
  { tree: { [SOURCE]: READS_A_SETTING }, flagged: [SOURCE] },
);

describe("each of those passes only because an override excuses it", () => {
  it.each(EXCUSED)("%s", (_what, file) => {
    expect(unexcused.flagged({ [file]: READS_A_SETTING })).toEqual([file]);
  });
});

describe("the configuration the repository commits", () => {
  it("fails a run rather than warning through one", () => {
    expect(config.rules[RULE]).toBe(SEVERITY);
    expect(config.plugins).toContain("node");
  });

  it("excuses config modules, the pass-through, tooling and suites, nothing wider", () => {
    expect(excused.map((override) => override.files)).toEqual([
      ["apps/api/src/config.ts", "apps/web/playwright.config.ts"],
      ["packages/core/src/store/git/index.ts"],
      ["scripts/**", "packages/devtools/src/**"],
      ["**/*.test.ts", "**/*.test.tsx", "**/test/**", "**/tests/**", "**/e2e/**"],
    ]);
  });
});

const DOOR = "packages/core/src/store/git/index.ts";
const UNEXCUSED_DOOR = "packages/core/src/store/git/probe.ts";

describe("the git store door, the one excused source file", () => {
  it("reads it in exactly one place", () => {
    const source = readFileSync(path.join(repositoryRoot, DOOR), "utf8");
    const reported = lint
      .output({ [UNEXCUSED_DOOR]: source })
      .split("\n")
      .filter((line) => line.startsWith(`${UNEXCUSED_DOOR}:`));

    expect(reported).toHaveLength(1);
  });
});
