import type { KnipConfig } from "knip";

/** Not gated: `--production`/`--strict` call helpers unused and their devDependencies unlisted. */
const config: KnipConfig = {
  // These are installed on the machine and never by npm, so no manifest names them.
  ignoreBinaries: ["uv", "jdocmunch-mcp"],

  // Nothing here is published, so an unimported entry export is dead; one kept
  // for a later route block carries `/** @public <block> */`.
  includeEntryExports: true,

  workspaces: {
    ".": {
      // A plan's measurement script is run by hand, so nothing imports it.
      entry: ["docs/plans/*/*.mjs"],

      // A skill's reference files are samples for other projects, so nothing here imports them.
      ignore: [".claude/skills/*/references/**"],
    },

    "apps/api": {
      vitest: {
        config: ["vitest.config.ts", "vitest.stryker.config.ts", "vitest.images.config.ts"],
      },

      ignore: [
        "lifts/**",

        "tests/fixtures/web-build/**",

        // Vendored skills, whose samples import packages the api does not depend on.
        ".claude/skills/**",
      ],
    },

    "apps/web": {
      entry: [
        // Installed ahead of its pages, so an unimported component or export is not dead code.
        "src/shared/ui/**",

        // A spec bundles it by its path, so nothing imports it.
        "test/support/blueprint-parts.tsx",
      ],
      includeEntryExports: false,
    },

    "packages/core": {
      // Stryker names the second by string and a script names each of the last two, so nothing imports them.
      vitest: {
        config: [
          "vitest.config.ts",
          "vitest.stryker.config.ts",
          "vitest.readings.config.ts",
          "vitest.budgets.config.ts",
        ],
      },
    },

    "packages/devtools": {
      // A suite runs this as a process of its own, so nothing imports it.
      entry: ["test/support/holds-a-container.ts"],

      ignore: ["lifts/**"],

      ignoreDependencies: [
        "@better-answers/devtools",
        "@stryker-mutator/core",
        "@stryker-mutator/vitest-runner",
        "cloc",
        "jscpd",
        "oxfmt",
      ],
    },
  },
};

export default config;
