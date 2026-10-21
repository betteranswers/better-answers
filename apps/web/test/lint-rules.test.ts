import { describe, expect, it } from "vitest";

import { readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";

const webOverrides = () =>
  readOxlintConfig().overrides.filter(
    (override) =>
      override.files?.[0]?.startsWith("apps/web") === true &&
      (override.rules?.["no-restricted-imports"] !== undefined ||
        override.rules?.["unicorn/filename-case"] !== undefined),
  );

if (webOverrides().length !== 5) {
  throw new Error(`expected five apps/web overrides, found ${webOverrides().length}`);
}

const { flagged } = oxlintOver(
  JSON.stringify({ plugins: ["typescript", "unicorn", "import"], overrides: webOverrides() }),
  {
    tree: { "apps/web/src/shared/sortOrder.ts": "export const keep = 1;\n" },
    flagged: ["apps/web/src/shared/sortOrder.ts"],
  },
);

const probe = (specifier: string): string =>
  `import * as probe from "${specifier}";\nexport const keep = probe;\n`;

const typeProbe = (specifier: string): string =>
  `import type { AppRouter } from "${specifier}";\nexport type Kept = AppRouter;\n`;

describe("no feature imports another feature", () => {
  it("refuses a sibling feature, allows its own files and shared", () => {
    const refused = flagged({
      "apps/web/src/features/model-choices/reaches-sideways.ts": probe("@/features/people/api.ts"),
      "apps/web/src/features/model-choices/reaches-sideways-relatively.ts":
        probe("../people/api.ts"),
      "apps/web/src/features/model-choices/reaches-itself.ts": probe("./api.ts"),
      "apps/web/src/features/model-choices/components/reaches-its-own-feature.ts":
        probe("../api.ts"),
      "apps/web/src/features/model-choices/reaches-shared.ts": probe("@/shared/api/trpc.ts"),
    });

    expect(refused).toEqual([
      "apps/web/src/features/model-choices/reaches-sideways-relatively.ts",
      "apps/web/src/features/model-choices/reaches-sideways.ts",
    ]);
  });
});

describe("imports run app \u2192 features \u2192 shared, never back", () => {
  it("refuses a feature importing the app layer, allows shared", () => {
    const refused = flagged({
      "apps/web/src/features/model-choices/reaches-up.ts": probe("@/app/router.tsx"),
      "apps/web/src/features/model-choices/reaches-up-relatively.ts": probe("../../app/router.tsx"),
      "apps/web/src/features/model-choices/reaches-down.ts": probe("@/shared/navigation.ts"),
    });

    expect(refused).toEqual([
      "apps/web/src/features/model-choices/reaches-up-relatively.ts",
      "apps/web/src/features/model-choices/reaches-up.ts",
    ]);
  });

  it("lets a page import shared's toolbar state, not the shell's", () => {
    const refused = flagged({
      "apps/web/src/features/sources/review-toolbar.ts": probe("@/shared/page-toolbar.tsx"),
      "apps/web/src/features/sources/reaches-the-shell.ts": probe("@/app/toolbar.tsx"),
    });

    expect(refused).toEqual(["apps/web/src/features/sources/reaches-the-shell.ts"]);
  });

  it("refuses shared importing upwards, allows app importing features and shared", () => {
    const refused = flagged({
      "apps/web/src/shared/reaches-a-feature.ts": probe("@/features/model-choices/api.ts"),
      "apps/web/src/shared/reaches-the-app.ts": probe("@/app/router.tsx"),
      "apps/web/src/shared/api/reaches-a-feature-relatively.ts": probe(
        "../../features/model-choices/api.ts",
      ),
      "apps/web/src/shared/stays-put.ts": probe("./navigation.ts"),
      "apps/web/src/app/composes-a-feature.ts": probe("@/features/model-choices/api.ts"),
      "apps/web/src/app/composes-shared.ts": probe("@/shared/navigation.ts"),
    });

    expect(refused).toEqual([
      "apps/web/src/shared/api/reaches-a-feature-relatively.ts",
      "apps/web/src/shared/reaches-a-feature.ts",
      "apps/web/src/shared/reaches-the-app.ts",
    ]);
  });
});

const HOOKS = "apps/web/src/features/auth/auth-hooks.ts";
const CLIENT = "apps/web/src/features/auth/auth-client.ts";

describe("better-auth is named in the auth seam and nowhere else", () => {
  it("allows the library in the client and hooks alone", () => {
    const refused = flagged({
      [CLIENT]: probe("better-auth/client"),
      [HOOKS]: probe("better-auth/client/plugins"),
      "apps/web/src/features/auth/sign-in-page.tsx": probe("better-auth/client"),
      "apps/web/src/features/auth/scoped.ts": probe("@better-auth/oauth-provider/client"),
      "apps/web/src/shared/ui/reaches-the-library.tsx": probe("better-auth/react"),
      "apps/web/src/features/model-choices/reaches-the-library.ts": probe("better-auth/client"),
      "apps/web/src/shared/api/reaches-the-library.ts": probe("better-auth/client"),
      "apps/web/src/app/reaches-the-library.ts": probe("@better-auth/oauth-provider/client"),
    });

    expect(refused).toEqual([
      "apps/web/src/app/reaches-the-library.ts",
      "apps/web/src/features/auth/scoped.ts",
      "apps/web/src/features/auth/sign-in-page.tsx",
      "apps/web/src/features/model-choices/reaches-the-library.ts",
      "apps/web/src/shared/api/reaches-the-library.ts",
      "apps/web/src/shared/ui/reaches-the-library.tsx",
    ]);
  });

  it("allows the client in the hooks alone", () => {
    const refused = flagged({
      [HOOKS]: probe("./auth-client.ts"),
      "apps/web/src/features/auth/sign-in-page.tsx": probe("./auth-client.ts"),
      "apps/web/src/app/reaches-the-client.ts": probe("@/features/auth/auth-client.ts"),
      "apps/web/test/reaches-the-client.ts": probe("@/features/auth/auth-client.ts"),
    });

    expect(refused).toEqual([
      "apps/web/src/app/reaches-the-client.ts",
      "apps/web/src/features/auth/sign-in-page.tsx",
      "apps/web/test/reaches-the-client.ts",
    ]);
  });

  it.each([
    ["a sibling feature", probe("@/features/model-choices/api.ts")],
    ["the app layer", probe("@/app/router.tsx")],
    ["the api", typeProbe("@better-answers/api/trpc")],
  ])("refuses the hooks reaching %s", (_reached, source) => {
    expect(flagged({ [HOOKS]: source })).toEqual([HOOKS]);
  });

  it("lets the hooks reach shared", () => {
    expect(flagged({ [HOOKS]: probe("@/shared/ui/button.tsx") })).toEqual([]);
  });
});

describe("filenames in the SPA are kebab-case", () => {
  it("refuses a camel-case filename and allows a kebab-case one", () => {
    const refused = flagged({
      "apps/web/src/shared/sortOrder.ts": "export const keep = 1;\n",
      "apps/web/src/shared/sort-order.ts": "export const keep = 1;\n",
    });

    expect(refused).toEqual(["apps/web/src/shared/sortOrder.ts"]);
  });
});

describe("AppRouter as a type, in one file only", () => {
  it("allows the type import in the client-instance file only", () => {
    const refused = flagged({
      "apps/web/src/shared/api/trpc.ts": typeProbe("@better-answers/api/trpc"),
      "apps/web/src/shared/api/second-client.ts": typeProbe("@better-answers/api/trpc"),
      "apps/web/src/features/model-choices/api.ts": typeProbe("@better-answers/api/trpc"),
    });

    expect(refused).toEqual([
      "apps/web/src/features/model-choices/api.ts",
      "apps/web/src/shared/api/second-client.ts",
    ]);
  });

  it("refuses a runtime api import, the client-instance file included", () => {
    const refused = flagged({
      "apps/web/src/shared/api/trpc.ts": probe("@better-answers/api/trpc"),
      "apps/web/src/app/pages/system-page.ts": probe("@better-answers/api/trpc"),
      "apps/web/src/features/model-choices/api.ts": probe("@better-answers/api/trpc"),
    });

    expect(refused).toEqual([
      "apps/web/src/app/pages/system-page.ts",
      "apps/web/src/features/model-choices/api.ts",
      "apps/web/src/shared/api/trpc.ts",
    ]);
  });

  it("lets a second api type into the client-instance file", () => {
    const refused = flagged({
      "apps/web/src/shared/api/trpc.ts": `import type { TrpcContext } from "@better-answers/api/trpc";\nexport type Kept = TrpcContext;\n`,
    });

    expect(refused).toEqual([]);
  });
});
