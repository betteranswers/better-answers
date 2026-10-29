import path from "node:path";

import apiStryker from "../apps/api/stryker.config.mjs";
import coreStryker from "../packages/core/stryker.config.mjs";
import { mutationShardsFromArgv } from "../packages/devtools/src/mutation/mutation-shards.ts";
import { repositoryRoot } from "../packages/devtools/src/paths.ts";

/** @type {ReadonlyMap<string, import("../packages/devtools/src/mutation/mutation-shards.ts").Leg>} */
export const legs = new Map([
  ["api", { root: path.join(repositoryRoot, "apps/api"), mutate: apiStryker.mutate }],
  ["core", { root: path.join(repositoryRoot, "packages/core"), mutate: coreStryker.mutate }],
]);

if (import.meta.main) {
  process.stdout.write(await mutationShardsFromArgv(process.argv.slice(2), legs));
}
