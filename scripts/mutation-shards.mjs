import path from "node:path";

import apiStryker from "../apps/api/stryker.config.mjs";
import { mutationShardsFromArgv } from "../packages/devtools/src/mutation-shards.ts";
import coreStryker from "../packages/core/stryker.config.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const legs = new Map([
  ["api", { root: path.join(repositoryRoot, "apps/api"), mutate: apiStryker.mutate }],
  ["core", { root: path.join(repositoryRoot, "packages/core"), mutate: coreStryker.mutate }],
]);

process.stdout.write(await mutationShardsFromArgv(process.argv.slice(2), legs));
