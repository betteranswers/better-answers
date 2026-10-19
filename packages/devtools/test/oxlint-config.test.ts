import { describe, expect, it } from "vitest";

import { parsedOxlintConfig } from "@better-answers/devtools/oxlint-config";

const URL_IN_A_STRING = "https://oxc.rs/docs/guide/usage/linter";

const commented = [
  "{",
  "  // A whole-line comment.",
  `  "options": { "docs": "${URL_IN_A_STRING}" },`,
  '  "rules": {},',
  '  "overrides": [],',
  '  "jsPlugins": [],',
  '  "plugins": [],',
  '  "categories": {}',
  "}",
].join("\n");

describe("the oxlint configuration as the suites read it", () => {
  it("drops a whole-line comment", () => {
    expect(parsedOxlintConfig(commented).rules).toEqual({});
  });

  it("keeps a `//` inside a string value", () => {
    expect(parsedOxlintConfig(commented).options).toEqual({ docs: URL_IN_A_STRING });
  });
});
