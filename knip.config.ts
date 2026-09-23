import { existsSync } from "node:fs";
import path from "node:path";

import type { KnipConfig } from "knip";

export const topLevelIgnore = (hasGitNexusIndex: boolean): readonly string[] =>
  hasGitNexusIndex ? [".gitnexus/**"] : [];

const config: KnipConfig = {
  ignore: [...topLevelIgnore(existsSync(path.resolve(import.meta.dirname, ".gitnexus")))],

  ignoreBinaries: ["uv"],

  workspaces: {
    ".": {
      ignoreDependencies: ["@ast-grep/cli"],
    },

    "apps/api": {
      ignore: [
        "lifts/**",

        "tests/fixtures/web-build/**",
      ],
    },

    "apps/web": {
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
