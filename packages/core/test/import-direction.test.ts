import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR 0029 rule 5 — nothing in `packages/core` imports a transport or a transport's
 * dependency — is held by a per-glob `no-restricted-imports` override in the root oxlint
 * config. A rule nobody has run is a convention, so this test runs it.
 *
 * The override is read out of the real `.oxlintrc.json` rather than restated here: a
 * restatement would pass while the repository's own config was broken. It is then applied
 * to a throwaway tree holding the same import under both globs, because the assertion is
 * as much about where the rule stays *silent* as about where it fires.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const oxlint = path.join(repoRoot, "node_modules", ".bin", "oxlint");

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

const lintFixture = (importSpecifier: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "import-direction-"));
  writeFileSync(path.join(dir, ".oxlintrc.json"), JSON.stringify({ overrides: [coreOverride()] }));
  for (const workspace of ["packages/core", "apps/api"]) {
    mkdirSync(path.join(dir, workspace), { recursive: true });
    writeFileSync(
      path.join(dir, workspace, "probe.ts"),
      `import * as transport from "${importSpecifier}";\nexport const probe = transport;\n`,
    );
  }
  try {
    return execFileSync(oxlint, ["--config", ".oxlintrc.json", "."], {
      cwd: dir,
      encoding: "utf8",
    });
  } catch (error) {
    // oxlint exits non-zero when it finds a diagnostic, which is the case under test.
    return String((error as { stdout?: string }).stdout ?? "");
  }
};

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
