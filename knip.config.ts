import type { KnipConfig } from "knip";

// Not gated: `--production`/`--strict` call helpers unused and their devDependencies unlisted.
const config: KnipConfig = {
  // `uv` is installed on the machine and never by npm, so no manifest names it.
  ignoreBinaries: ["uv"],

  // Nothing here is published, so an unimported entry export is dead; one kept for a later route
  // block carries `/** @public <block> */`.
  includeEntryExports: true,

  workspaces: {
    ".": {
      // A spawned binary is no edge for knip to follow.
      ignoreDependencies: ["@ast-grep/cli"],
    },

    "apps/api": {
      ignore: [
        "lifts/**",

        "tests/fixtures/web-build/**",
      ],
    },

    "apps/web": {
      // Installed for a surface no ticket has opened yet, so a component nothing imports, or an
      // export of one, is not dead code.
      entry: ["src/shared/ui/**"],
      includeEntryExports: false,
    },

    "packages/devtools": {
      ignore: ["lifts/**"],

      ignoreDependencies: [
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
