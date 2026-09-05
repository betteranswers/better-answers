import { readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

/**
 * The SPA's rules, run rather than remembered (`[CHECK1]`): the layering zones (`[WEB1]` — app → features
 * → shared, never back, and no feature reaching another), the one directory that names
 * Better Auth (`[WEB2]`), kebab-case filenames (`[WEB3]`'s file half), and ADR 0006's one
 * exception — `AppRouter` as an `import type` in the client-instance file and nowhere else
 * (`[WEB4]`).
 *
 * Each rule is applied to a throwaway tree, so the assertion is as much about where the rule
 * stays silent as where it fires. The tree, the run and the reading of the report are the
 * devtools runner's, so a linter that could not run cannot read here as a rule that stayed
 * quiet. The zones themselves are per-glob `no-restricted-imports` overrides because oxlint
 * 1.80 has no `import/no-restricted-paths`.
 */

/**
 * The SPA's overrides, in the order the real config declares them — which matters, because a
 * later override replaces an earlier one's configuration of the same rule and the zones are
 * built on exactly that. The react-doctor override over `apps/web/**` is left out by the
 * filter: it sets neither of the two rules under test.
 */
const webOverrides = () =>
  readOxlintConfig().overrides.filter(
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

/**
 * Lint a tree (path → source) under the SPA's real overrides, and name the paths oxlint
 * reported a diagnostic against.
 *
 * The smoke case is a file whose name `unicorn/filename-case` must refuse, and the one path
 * that must come back for it. Nothing below is allowed to read a silence as "the rule stayed
 * quiet" until oxlint has answered it: an oxlint that cannot run, one whose config it
 * refused, or one whose reporter changed would otherwise turn every assertion in this file
 * into a tautology that passes.
 */
const { flagged } = oxlintOver(
  JSON.stringify({ plugins: ["typescript", "unicorn", "import"], overrides: webOverrides() }),
  {
    tree: { "apps/web/src/shared/routeTable.ts": "export const keep = 1;\n" },
    flagged: ["apps/web/src/shared/routeTable.ts"],
  },
);

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
  it("allows the client in the one directory that owns identity, and refuses it outside", () => {
    const refused = flagged({
      "apps/web/src/features/auth/auth-client.ts": probe("better-auth/client"),
      "apps/web/src/features/auth/deep.ts": probe("better-auth/client/plugins"),
      "apps/web/src/features/auth/scoped.ts": probe("@better-auth/oauth-provider/client"),
      "apps/web/src/shared/ui/reaches-the-library.tsx": probe("better-auth/react"),
      "apps/web/src/features/routes/reaches-the-library.ts": probe("better-auth/client"),
      "apps/web/src/shared/api/reaches-the-library.ts": probe("better-auth/client"),
      "apps/web/src/app/reaches-the-library.ts": probe("@better-auth/oauth-provider/client"),
    });

    // One glob and no carve-out: the registry's auth files that once sat under `shared/`
    // left with `@better-auth-ui/*` (T-046), so `shared/ui/` reaching for `better-auth` is
    // refused like anywhere else, and the scoped `@better-auth/*` client plugin is allowed
    // in the module and nowhere else.
    expect(refused).toEqual([
      "apps/web/src/app/reaches-the-library.ts",
      "apps/web/src/features/routes/reaches-the-library.ts",
      "apps/web/src/shared/api/reaches-the-library.ts",
      "apps/web/src/shared/ui/reaches-the-library.tsx",
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
