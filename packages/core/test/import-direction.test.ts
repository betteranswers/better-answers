import { oxlintOverrideFor, readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

/**
 * Two of ADR 0029's import-direction rules are held by one per-glob `no-restricted-imports`
 * override in the root oxlint config: rule 5 — nothing in `packages/core` imports a transport
 * or a transport's dependency — and rule 4 — a slice reaches a sibling slice, a store door or
 * a layer only through its `index.ts`, never an internal file. A rule nobody has run is a
 * convention, so this test runs both, each where it fires and where it stays silent
 * (`[CHECK1]`, `[TEST7]`).
 *
 * The override is read out of the real `.oxlintrc.json` rather than restated here: a
 * restatement would pass while the repository's own config was broken. It is then applied
 * to a throwaway tree holding the same import under both globs, because the assertion is
 * as much about where the rule stays *silent* as about where it fires.
 *
 * The tree and the oxlint run are the devtools runner's, which is what stops this suite
 * reading a linter that could not run as a rule that stayed quiet: an empty output satisfies
 * every assertion below, so an empty output has to be impossible unless the rule was silent.
 */

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
const lint = oxlintOver(JSON.stringify({ overrides: [oxlintOverrideFor("packages/core/**")] }), {
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

/**
 * Rule 4's subject is a relative import, so the probe sits where a slice file sits. Three
 * positions: a slice file, one directory below `src/`; a store door's face, two below, which
 * reaches `kernel` and `access` through `../../`; and a test under `packages/core/test/`,
 * which reaches a slice through `../src/` and is held to the same face. The pattern lifts
 * the ban for the faces the tree has and not for every `index.ts`, which the nested-face
 * case below is there to prove.
 */
const SLICE_FILE = "packages/core/src/concepts/landing.ts";
const DOOR_FILE = "packages/core/src/store/graph/index.ts";
const TEST_FILE = "packages/core/test/concepts.test.ts";

const relativeImportAt = (
  file: string,
  importSpecifier: string,
): Readonly<Record<string, string>> => ({
  [file]: `import * as sibling from "${importSpecifier}";\nexport const probe = sibling;\n`,
});

describe("the index.ts rule over packages/core's slices", () => {
  it("fires on a sibling slice's internal file", () => {
    const output = lint.output(relativeImportAt(SLICE_FILE, "../guides/renderer.ts"));

    expect(output).toContain(SLICE_FILE);
    expect(output).toContain("no-restricted-imports");
  });

  it.each([
    [SLICE_FILE, "../store/postgres/handle.ts"],
    [SLICE_FILE, "../concepts/../guides/renderer.ts"],
    [DOOR_FILE, "../../kernel/actor.ts"],
    [DOOR_FILE, "../../access/predicate.ts"],
    [SLICE_FILE, "../guides/internal/index.ts"],
    [TEST_FILE, "../src/concepts/file.ts"],
  ])("fires from %s on %s", (file, specifier) => {
    expect(lint.flagged(relativeImportAt(file, specifier))).toEqual([file]);
  });

  it.each([
    [SLICE_FILE, "../guides/index.ts"],
    [SLICE_FILE, "../store/postgres/index.ts"],
    [SLICE_FILE, "./inbox.ts"],
    [DOOR_FILE, "../../kernel/index.ts"],
    [DOOR_FILE, "../../access/index.ts"],
    [TEST_FILE, "../src/concepts/index.ts"],
    [TEST_FILE, "../src/store/postgres/index.ts"],
    [TEST_FILE, "./suite-postgres.ts"],
  ])("stays silent from %s on %s", (file, specifier) => {
    expect(lint.flagged(relativeImportAt(file, specifier))).toEqual([]);
  });

  it("stays silent outside packages/core for the same import", () => {
    expect(
      lint.flagged(relativeImportAt("apps/api/src/routers/probe.ts", "../auth/claims.ts")),
    ).toEqual([]);
  });

  // The runner above carries the one override alone, so it cannot see a later override in
  // the real config re-setting `no-restricted-imports` over a core file — oxlint replaces a
  // rule's options per override rather than merging them, and the test-file overrides come
  // after this one. So the shape is asserted instead: after the core override, no override
  // whose glob can reach packages/core sets the rule again.
  it("is the last override in the config to set no-restricted-imports over packages/core", () => {
    const { overrides } = readOxlintConfig();
    const core = overrides.findIndex((override) => override.files?.includes("packages/core/**"));
    const later = overrides
      .slice(core + 1)
      .filter((override) => override.rules?.["no-restricted-imports"] !== undefined)
      .flatMap((override) => override.files ?? [])
      .filter((glob) => glob.startsWith("**") || glob.startsWith("packages/core"));

    expect(core).toBeGreaterThanOrEqual(0);
    expect(later).toEqual([]);
  });
});
