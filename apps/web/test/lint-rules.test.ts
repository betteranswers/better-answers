import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The SPA's rules, run rather than remembered: the layering zones (app → features → shared,
 * never back, and no feature reaching another), kebab-case filenames, and ADR 0006's one
 * exception — `AppRouter` as an `import type` in the client-instance file and nowhere else.
 *
 * Each rule is applied to a throwaway tree, so the assertion is as much about where the rule
 * stays silent as where it fires. This is the shape `apps/api/tests/lint-rules.test.ts` uses;
 * the zones themselves are per-glob `no-restricted-imports` overrides because oxlint 1.80 has
 * no `import/no-restricted-paths`.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const oxlint = path.join(repoRoot, "node_modules", ".bin", "oxlint");

/** JSONC: the repo's config carries the comments explaining each rule. */
const readConfig = (): {
  overrides: { files?: string[]; rules?: Record<string, unknown> }[];
} =>
  JSON.parse(
    readFileSync(path.join(repoRoot, ".oxlintrc.json"), "utf8").replaceAll(/^\s*\/\/.*$/gm, ""),
  ) as ReturnType<typeof readConfig>;

/**
 * The SPA's overrides, in the order the real config declares them — which matters, because a
 * later override replaces an earlier one's configuration of the same rule and the zones are
 * built on exactly that. The react-doctor override over `apps/web/**` is left out by the
 * filter: it sets neither of the two rules under test.
 */
const webOverrides = () =>
  readConfig().overrides.filter(
    (override) =>
      override.files?.[0]?.startsWith("apps/web") === true &&
      (override.rules?.["no-restricted-imports"] !== undefined ||
        override.rules?.["unicorn/filename-case"] !== undefined),
  );

// The four the SPA owns. A fifth added without a case below would be run by this suite and
// asserted by nothing, which is the failure a rule test exists to prevent.
if (webOverrides().length !== 4) {
  throw new Error(`expected four apps/web overrides, found ${webOverrides().length}`);
}

type Fixture = Readonly<Record<string, string>>;

/** Lint `files` (path → source) under the SPA's real overrides, returning oxlint's output. */
const lint = (files: Fixture): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "t036-lint-"));
  writeFileSync(
    path.join(dir, ".oxlintrc.json"),
    JSON.stringify({ plugins: ["typescript", "unicorn", "import"], overrides: webOverrides() }),
  );
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), source);
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

/**
 * The paths oxlint reported a diagnostic against, read off the `path:line:column:` column of
 * each line. Asserted on rather than on the raw output, because a rule's help text names the
 * file it points the reader at — `Rename the file to 'route-table.ts'` — and a substring
 * search over the whole output would read that as a second diagnostic.
 */
const flagged = (files: Fixture): readonly string[] =>
  [
    ...new Set(
      lint(files)
        .split("\n")
        .map((line) => /^(?<file>[^\s:]+):\d+:\d+:/.exec(line)?.groups?.["file"])
        .filter((file): file is string => file !== undefined),
    ),
  ].sort();

const probe = (specifier: string): string =>
  `import * as probe from "${specifier}";\nexport const keep = probe;\n`;

const typeProbe = (specifier: string): string =>
  `import type { AppRouter } from "${specifier}";\nexport type Kept = AppRouter;\n`;

describe("no feature imports another feature", () => {
  it("refuses a sibling feature and allows a feature's own files and shared", () => {
    const refused = flagged({
      "apps/web/src/features/routes/reaches-sideways.ts": probe("@/features/people/api.ts"),
      "apps/web/src/features/routes/reaches-sideways-relatively.ts": probe("../people/api.ts"),
      "apps/web/src/features/routes/reaches-itself.ts": probe("./api.ts"),
      "apps/web/src/features/routes/components/reaches-its-own-feature.ts": probe("../api.ts"),
      "apps/web/src/features/routes/reaches-shared.ts": probe("@/shared/api/trpc.ts"),
    });

    expect(refused).toEqual([
      "apps/web/src/features/routes/reaches-sideways-relatively.ts",
      "apps/web/src/features/routes/reaches-sideways.ts",
    ]);
  });
});

describe("the direction is app \u2192 features \u2192 shared and never back", () => {
  it("refuses a feature importing the app layer, and allows it importing shared", () => {
    const refused = flagged({
      "apps/web/src/features/routes/reaches-up.ts": probe("@/app/router.tsx"),
      "apps/web/src/features/routes/reaches-up-relatively.ts": probe("../../app/router.tsx"),
      "apps/web/src/features/routes/reaches-down.ts": probe("@/shared/screens.ts"),
    });

    expect(refused).toEqual([
      "apps/web/src/features/routes/reaches-up-relatively.ts",
      "apps/web/src/features/routes/reaches-up.ts",
    ]);
  });

  it("refuses shared importing a feature or the app layer, and allows the app layer importing both", () => {
    const refused = flagged({
      "apps/web/src/shared/reaches-a-feature.ts": probe("@/features/routes/api.ts"),
      "apps/web/src/shared/reaches-the-app.ts": probe("@/app/router.tsx"),
      "apps/web/src/shared/api/reaches-a-feature-relatively.ts": probe(
        "../../features/routes/api.ts",
      ),
      "apps/web/src/shared/stays-put.ts": probe("./screens.ts"),
      "apps/web/src/app/composes-a-feature.ts": probe("@/features/routes/api.ts"),
      "apps/web/src/app/composes-shared.ts": probe("@/shared/screens.ts"),
    });

    expect(refused).toEqual([
      "apps/web/src/shared/api/reaches-a-feature-relatively.ts",
      "apps/web/src/shared/reaches-a-feature.ts",
      "apps/web/src/shared/reaches-the-app.ts",
    ]);
  });
});

describe("filenames in the SPA are kebab-case", () => {
  it("refuses a camel-case filename and allows a kebab-case one", () => {
    const refused = flagged({
      "apps/web/src/shared/routeTable.ts": "export const keep = 1;\n",
      "apps/web/src/shared/route-table.ts": "export const keep = 1;\n",
    });

    expect(refused).toEqual(["apps/web/src/shared/routeTable.ts"]);
  });
});

describe("ADR 0006's one exception \u2014 AppRouter as a type, in one file", () => {
  it("allows the type import in the client-instance file and refuses it in a second file", () => {
    const refused = flagged({
      "apps/web/src/shared/api/trpc.ts": typeProbe("@better-answers/api/trpc"),
      "apps/web/src/shared/api/second-client.ts": typeProbe("@better-answers/api/trpc"),
      "apps/web/src/features/routes/api.ts": typeProbe("@better-answers/api/trpc"),
    });

    expect(refused).toEqual([
      "apps/web/src/features/routes/api.ts",
      "apps/web/src/shared/api/second-client.ts",
    ]);
  });

  it("refuses a runtime import from the api, in the client-instance file as much as outside it", () => {
    const refused = flagged({
      "apps/web/src/shared/api/trpc.ts": probe("@better-answers/api/trpc"),
      "apps/web/src/app/screens/system-screen.ts": probe("@better-answers/api/trpc"),
      "apps/web/src/features/routes/api.ts": probe("@better-answers/api/trpc"),
    });

    expect(refused).toEqual([
      "apps/web/src/app/screens/system-screen.ts",
      "apps/web/src/features/routes/api.ts",
      "apps/web/src/shared/api/trpc.ts",
    ]);
  });

  it("lets a second api type into the client-instance file, because what the rule bans is runtime coupling", () => {
    // Where the rule deliberately stays silent. oxlint 1.80 ignores `allowImportNames` beside
    // `allowTypeImports`, so this file's exception is `import type`-only rather than
    // `AppRouter`-only — which is the guarantee ADR 0006's amendment states, since a type
    // erases at build time whatever it is called. A value import is still refused, above.
    const refused = flagged({
      "apps/web/src/shared/api/trpc.ts": `import type { TrpcContext } from "@better-answers/api/trpc";\nexport type Kept = TrpcContext;\n`,
    });

    expect(refused).toEqual([]);
  });
});
