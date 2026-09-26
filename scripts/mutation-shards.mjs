import path from "node:path";

import apiStryker from "../apps/api/stryker.config.mjs";
import coreStryker from "../packages/core/stryker.config.mjs";
import { mutationShardsFromArgv } from "../packages/devtools/src/mutation-shards.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

/** @type {ReadonlyMap<string, import("../packages/devtools/src/mutation-shards.ts").Leg>} */
export const legs = new Map([
  ["api", { root: path.join(repositoryRoot, "apps/api"), mutate: apiStryker.mutate }],
  [
    "core",
    {
      root: path.join(repositoryRoot, "packages/core"),
      mutate: coreStryker.mutate,
      // Each of these files alone outruns a shard's 120-minute ceiling.
      split: new Map([
        ["src/store/git/index.ts", 4],
        ["src/store/graph/index.ts", 2],
      ]),
    },
  ],
]);

if (import.meta.main) {
  process.stdout.write(await mutationShardsFromArgv(process.argv.slice(2), legs));
}
