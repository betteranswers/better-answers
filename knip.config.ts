import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // `uv` is installed on the machine and never by npm, so no manifest names it.
  ignoreBinaries: ["uv"],

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
      // Installed for a surface no ticket has opened yet, so a component nothing imports is not
      // dead code.
      entry: ["src/shared/ui/**"],
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
