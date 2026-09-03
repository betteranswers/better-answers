import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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

/**
 * Resolved through the module graph rather than assembled from a path, because pnpm's layout
 * puts a binary where the package that declares it can reach it and not necessarily at the
 * root — and a wrong path here does not fail loudly, it makes every rule look silent.
 */
const oxlint = (() => {
  const manifest = createRequire(import.meta.url).resolve("oxlint/package.json");
  const binary = path.join(path.dirname(manifest), "bin", "oxlint");
  if (!existsSync(binary)) throw new Error(`oxlint's binary is not at ${binary}`);
  return binary;
})();

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

// The five the SPA owns. A sixth added without a case below would be run by this suite and
// asserted by nothing, which is the failure a rule test exists to prevent.
if (webOverrides().length !== 5) {
  throw new Error(`expected five apps/web overrides, found ${webOverrides().length}`);
}

type Fixture = Readonly<Record<string, string>>;

/**
 * Lint `files` (path → source) under the SPA's real overrides, returning oxlint's output.
 *
 * The failure this shape has to avoid is the silent one: if oxlint cannot be run at all, or
 * refuses the config, the natural `catch` returns an empty string, every "it fires here"
 * assertion sees no diagnostics, and the whole suite passes while enforcing nothing. So the
 * only tolerated non-zero exit is oxlint's own "I found something" (1); anything else is
 * re-thrown with what it wrote to stderr, and the smoke check below proves the command works
 * before any case trusts a silence.
 */
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
    // The format is pinned rather than left to oxlint: it picks GitHub's annotation reporter
    // when it detects Actions, which buries the path inside a `::error file=…::` line where
    // the `path:line:column:` reader below cannot see it — every rule then reads as silent,
    // which is exactly what CI found while this suite passed locally. `unix` is the one
    // format that is a stable `path:line:column: message` line and never a drawn box.
    return execFileSync(oxlint, ["--config", ".oxlintrc.json", "--format=unix", "."], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    const failure = cause as { status?: number | null; stdout?: string; stderr?: string };
    if (failure.status === 1) return String(failure.stdout ?? "");
    throw new Error(
      `oxlint (${oxlint}) did not run: exit ${String(failure.status)}\n${String(failure.stderr ?? cause)}`,
    );
  }
};

/**
 * The paths oxlint reported a diagnostic against, read off the `path:line:column:` column of
 * each line. Asserted on rather than on the raw output, because a rule's help text names the
 * file it points the reader at — `Rename the file to 'route-table.ts'` — and a substring
 * search over the whole output would read that as a second diagnostic.
 */
const flagged = (files: Fixture): readonly string[] => {
  const output = lint(files);
  return [
    ...new Set(
      output
        .split("\n")
        .map((line) => /^(?<file>[^\s:]+):\d+:\d+:/.exec(line)?.groups?.["file"])
        .filter((file): file is string => file !== undefined),
    ),
  ].sort();
};

// The command works and its output is in the shape `flagged` reads, proved before any case
// below is allowed to read a silence as "the rule stayed quiet". Without this, an oxlint that
// cannot run, or one whose reporter changed, turns every assertion in this file into a
// tautology that passes.
const smoke = flagged({ "apps/web/src/shared/routeTable.ts": "export const keep = 1;\n" });
if (smoke.length !== 1) {
  throw new Error(
    `oxlint reported nothing for a file that must fail unicorn/filename-case; raw output was:\n${lint(
      { "apps/web/src/shared/routeTable.ts": "export const keep = 1;\n" },
    )}`,
  );
}

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

describe("better-auth is named in the identity feature and nowhere else", () => {
  it("allows the client where the feature that owns identity lives, and refuses it outside", () => {
    const refused = flagged({
      "apps/web/src/features/auth/auth-client.ts": probe("better-auth/client"),
      "apps/web/src/shared/ui/auth/provider.tsx": probe("better-auth/react"),
      "apps/web/src/features/routes/reaches-the-library.ts": probe("better-auth/client"),
      "apps/web/src/shared/api/reaches-the-library.ts": probe("better-auth/client"),
      "apps/web/src/app/reaches-the-library.ts": probe("@better-auth/oauth-provider/client"),
    });

    expect(refused).toEqual([
      "apps/web/src/app/reaches-the-library.ts",
      "apps/web/src/features/routes/reaches-the-library.ts",
      "apps/web/src/shared/api/reaches-the-library.ts",
    ]);
  });

  it("keeps every other rule over the identity feature: it may not reach sideways, or up", () => {
    const refused = flagged({
      "apps/web/src/features/auth/reaches-sideways.ts": probe("@/features/routes/api.ts"),
      "apps/web/src/features/auth/reaches-up.ts": probe("@/app/router.tsx"),
      "apps/web/src/features/auth/reaches-the-api.ts": typeProbe("@better-answers/api/trpc"),
      "apps/web/src/features/auth/reaches-down.ts": probe("@/shared/ui/button.tsx"),
    });

    expect(refused).toEqual([
      "apps/web/src/features/auth/reaches-sideways.ts",
      "apps/web/src/features/auth/reaches-the-api.ts",
      "apps/web/src/features/auth/reaches-up.ts",
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
