import path from "node:path";

import apiStryker from "../apps/api/stryker.config.mjs";
import { mutationShardsFromArgv } from "../packages/devtools/src/mutation-shards.ts";
import coreStryker from "../packages/core/stryker.config.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const legs = new Map([
  ["api", { root: path.join(repositoryRoot, "apps/api"), mutate: apiStryker.mutate }],
  [
    "core",
    {
      root: path.join(repositoryRoot, "packages/core"),
      mutate: coreStryker.mutate,
      // Each alone took past the 120-minute ceiling in the forced run of 25/09/2026.
      split: new Map([
        ["src/store/git/index.ts", 4],
        ["src/store/graph/index.ts", 2],
      ]),
    },
  ],
]);

process.stdout.write(await mutationShardsFromArgv(process.argv.slice(2), legs));
