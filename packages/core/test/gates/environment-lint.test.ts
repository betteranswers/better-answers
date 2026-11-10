import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { rootsOf } from "@better-answers/schema/testing/roots";

const { repositoryRoot } = rootsOf(import.meta.url);

const RULE = "node/no-process-env";
const SEVERITY = "error";

const config = readOxlintConfig();

const excused = config.overrides.filter((override) => override.rules?.[RULE] === "off");

const READS_A_SETTING = `export const dsn = process.env["DATABASE_URL"] ?? "";\n`;

const SOURCE = "packages/core/src/concepts/import/landing.ts";

const lint = oxlintOver(
  JSON.stringify({
    plugins: config.plugins,
    rules: { [RULE]: SEVERITY },
    overrides: excused.map((override) => ({ files: override.files, rules: { [RULE]: "off" } })),
  }),
  { tree: { [SOURCE]: READS_A_SETTING }, flagged: [SOURCE] },
);

describe("node/no-process-env flags a process.env read in source", () => {
  it.each([
    ["a slice of the business logic", SOURCE],
    ["a store door", "packages/core/src/store/postgres/index.ts"],
    ["the api's server", "apps/api/src/server.ts"],
    ["an api transport", "apps/api/src/trpc/router.ts"],
    ["the SPA's entry", "apps/web/src/main.tsx"],
    ["a page under a feature", "apps/web/src/features/auth/sign-in-page.tsx"],
    ["a shared package", "packages/schema/src/knowledge/concept-tables.ts"],
  ])("%s", (_what, file) => {
    expect(lint.flagged({ [file]: READS_A_SETTING })).toEqual([file]);
  });
});

const EXCUSED: readonly (readonly [string, string])[] = [
  ["the api's config module", "apps/api/src/config.ts"],
  ["the browser suite's configuration", "apps/web/playwright.config.ts"],
  ["the git store door's allow-list", "packages/core/src/store/git/door.ts"],
  ["a repository script", "scripts/check.mjs"],
  ["the gate tooling", "packages/devtools/src/throwaway-tree.ts"],
  ["a test", "packages/core/test/store/git/git.test.ts"],
  ["a test that renders", "apps/web/test/frame.test.tsx"],
  ["a test helper beside it", "packages/core/test/fixtures/bundle.ts"],
  ["a suite under a plural directory", "apps/api/tests/images/image-probe.ts"],
  ["a browser spec", "apps/web/e2e/models-and-spend.spec.ts"],
];

describe("node/no-process-env allows a read in an excused file", () => {
  it.each(EXCUSED)("%s", (_what, file) => {
    expect(lint.flagged({ [file]: READS_A_SETTING })).toEqual([]);
  });
});

const unexcused = oxlintOver(
  JSON.stringify({ plugins: config.plugins, rules: { [RULE]: SEVERITY } }),
  { tree: { [SOURCE]: READS_A_SETTING }, flagged: [SOURCE] },
);

describe("flags each excused file once its override is removed", () => {
  it.each(EXCUSED)("%s", (_what, file) => {
    expect(unexcused.flagged({ [file]: READS_A_SETTING })).toEqual([file]);
  });
});

describe("the committed .oxlintrc.json", () => {
  it("sets node/no-process-env to error, not warn", () => {
    expect(config.rules[RULE]).toBe(SEVERITY);
    expect(config.plugins).toContain("node");
  });

  it("excuses only config modules, the git door, tooling and tests", () => {
    expect(excused.map((override) => override.files)).toEqual([
      ["apps/api/src/config.ts", "apps/web/playwright.config.ts"],
      ["packages/core/src/store/git/door.ts"],
      ["scripts/**", "packages/devtools/src/**"],
      ["**/*.test.ts", "**/*.test.tsx", "**/test/**", "**/tests/**", "**/e2e/**"],
    ]);
  });
});

const DOOR = "packages/core/src/store/git/door.ts";
const UNEXCUSED_DOOR = "packages/core/src/store/git/probe.ts";

describe("the git store door, the only excused source file", () => {
  it("reads process.env in exactly one place", () => {
    const source = readFileSync(path.join(repositoryRoot, DOOR), "utf8");
    const reported = lint
      .output({ [UNEXCUSED_DOOR]: source })
      .split("\n")
      .filter((line) => line.startsWith(`${UNEXCUSED_DOOR}:`));

    expect(reported).toHaveLength(1);
  });
});
