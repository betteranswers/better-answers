import type { KnipConfig } from "knip";

/** Not gated: `--production`/`--strict` call helpers unused and their devDependencies unlisted. */
const config: KnipConfig = {
  // `uv` and `openssl` are installed on the machine and never by npm, so no manifest names them.
  ignoreBinaries: ["uv", "openssl"],

  // Nothing here is published, so an unimported entry export is dead; one kept for a later route
  // block carries `/** @public <block> */`.
  includeEntryExports: true,

  workspaces: {
    ".": {
      // A skill's reference files are samples for other projects, so nothing here imports them.
      ignore: [".claude/skills/*/references/**"],
    },

    "apps/api": {
      vitest: { config: ["vitest.config.ts", "vitest.stryker.config.ts"] },

      ignore: [
        "lifts/**",

        "tests/fixtures/web-build/**",

        // Vendored skills, whose samples import packages the api does not depend on.
        ".claude/skills/**",
      ],
    },

    "apps/web": {
      entry: [
        // Installed for a surface no ticket has opened yet, so a component nothing imports, or an
        // export of one, is not dead code.
        "src/shared/ui/**",

        "journeys/*.spec.ts",
        "journeys/outcome-reporter.ts",
      ],
      includeEntryExports: false,
    },

    "apps/test-inbox": {
      // `wrangler.jsonc` names it; wrangler is no dependency, so no knip plugin reads that file.
      entry: ["src/index.ts"],
    },

    "packages/core": {
      // Stryker names the second by string, so nothing imports it.
      vitest: { config: ["vitest.config.ts", "vitest.stryker.config.ts"] },
    },

    "packages/devtools": {
      // A suite runs this as a process of its own, so nothing imports it.
      entry: ["test/holds-a-container.ts"],

      ignore: ["lifts/**"],

      ignoreDependencies: [
        "@ast-grep/cli",
        "@better-answers/devtools",
        "@stryker-mutator/core",
        "@stryker-mutator/vitest-runner",
        "cloc",
        "jscpd",
      ],
    },
  },
};

export default config;
