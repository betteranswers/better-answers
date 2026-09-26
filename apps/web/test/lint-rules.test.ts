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
    tree: { "apps/web/src/shared/routeTable.ts": "export const keep = 1;\n" },
    flagged: ["apps/web/src/shared/routeTable.ts"],
  },
);

const probe = (specifier: string): string =>
  `import * as probe from "${specifier}";\nexport const keep = probe;\n`;

const typeProbe = (specifier: string): string =>
  `import type { AppRouter } from "${specifier}";\nexport type Kept = AppRouter;\n`;

describe("no feature imports another feature", () => {
  it("refuses a sibling feature, allows its own files and shared", () => {
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

describe("imports run app \u2192 features \u2192 shared, never back", () => {
  it("refuses a feature importing the app layer, allows shared", () => {
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

  it("lets a view import shared's toolbar state, not the shell's", () => {
    const refused = flagged({
      "apps/web/src/features/sources/review-toolbar.ts": probe("@/shared/view-toolbar.tsx"),
      "apps/web/src/features/sources/reaches-the-shell.ts": probe("@/app/toolbar.tsx"),
    });

    expect(refused).toEqual(["apps/web/src/features/sources/reaches-the-shell.ts"]);
  });

  it("refuses shared importing upwards, allows app importing features and shared", () => {
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
  it("allows the client in the identity feature, refuses it outside", () => {
    const refused = flagged({
      "apps/web/src/features/auth/auth-client.ts": probe("better-auth/client"),
      "apps/web/src/features/auth/deep.ts": probe("better-auth/client/plugins"),
      "apps/web/src/features/auth/scoped.ts": probe("@better-auth/oauth-provider/client"),
      "apps/web/src/shared/ui/reaches-the-library.tsx": probe("better-auth/react"),
      "apps/web/src/features/routes/reaches-the-library.ts": probe("better-auth/client"),
      "apps/web/src/shared/api/reaches-the-library.ts": probe("better-auth/client"),
      "apps/web/src/app/reaches-the-library.ts": probe("@better-auth/oauth-provider/client"),
    });

    expect(refused).toEqual([
      "apps/web/src/app/reaches-the-library.ts",
      "apps/web/src/features/routes/reaches-the-library.ts",
      "apps/web/src/shared/api/reaches-the-library.ts",
      "apps/web/src/shared/ui/reaches-the-library.tsx",
    ]);
  });

  it("holds the identity feature to every other import rule", () => {
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

describe("AppRouter as a type, in one file only", () => {
  it("allows the type import in the client-instance file only", () => {
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

  it("refuses a runtime api import, the client-instance file included", () => {
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

  it("lets a second api type into the client-instance file", () => {
    const refused = flagged({
      "apps/web/src/shared/api/trpc.ts": `import type { TrpcContext } from "@better-answers/api/trpc";\nexport type Kept = TrpcContext;\n`,
    });

    expect(refused).toEqual([]);
  });
});
