import { readFileSync } from "node:fs";
import path from "node:path";

import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

/**
 * ADR 0029 rule 5 — nothing in `packages/core` imports a transport or a transport's
 * dependency — is held by a per-glob `no-restricted-imports` override in the root oxlint
 * config. A rule nobody has run is a convention, so this test runs it (`[CHECK1]`).
 *
 * The override is read out of the real `.oxlintrc.json` rather than restated here: a
 * restatement would pass while the repository's own config was broken. It is then applied
 * to a throwaway tree holding the same import under both globs, because the assertion is
 * as much about where the rule stays *silent* as about where it fires.
 *
 * The tree and the oxlint run are the devtools runner's, which is what stops this suite
 * reading a linter that could not run as a rule that stayed quiet: it used to swallow every
 * non-zero exit into an empty string, and an empty string satisfies every assertion below.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");

/** JSONC: the repo's config carries the comments explaining each rule. */
const readConfig = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(path.join(repoRoot, ".oxlintrc.json"), "utf8").replaceAll(/^\s*\/\/.*$/gm, ""),
  ) as Record<string, unknown>;

const coreOverride = (): unknown => {
  const overrides = readConfig()["overrides"] as { files?: string[] }[];
  const found = overrides.find((o) => o.files?.length === 1 && o.files[0] === "packages/core/**");
  if (found === undefined) throw new Error("no `packages/core/**` override in .oxlintrc.json");
  return found;
};

const bothWorkspaces = (importSpecifier: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    ["packages/core", "apps/api"].map((workspace) => [
      `${workspace}/probe.ts`,
      `import * as transport from "${importSpecifier}";\nexport const probe = transport;\n`,
    ]),
  );

// The smoke case: the rule's own subject, under both globs, with the one path that must come
// back. Until oxlint answers this the way the config says it will, no silence below means
// anything.
const lint = oxlintOver(JSON.stringify({ overrides: [coreOverride()] }), {
  tree: bothWorkspaces("hono"),
  flagged: ["packages/core/probe.ts"],
});

const lintFixture = (importSpecifier: string): string =>
  lint.output(bothWorkspaces(importSpecifier));

describe("the transport ban over packages/core", () => {
  it("fires on a transport import inside packages/core and stays silent in apps/api", () => {
    const output = lintFixture("hono");

    expect(output).toContain("packages/core/probe.ts");
    expect(output).toContain("no-restricted-imports");
    expect(output).not.toContain("apps/api/probe.ts");
  });

  it.each([
    "@hono/node-server",
    "@trpc/server",
    "@modelcontextprotocol/sdk",
    "better-auth",
    "node:http",
  ])("bans %s too, not hono alone", (specifier) => {
    expect(lintFixture(specifier)).toContain("packages/core/probe.ts");
  });
});
