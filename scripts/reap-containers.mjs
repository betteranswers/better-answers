import { reapContainers } from "../packages/devtools/src/reap-containers.ts";

process.exit(reapContainers(process.argv.slice(2)));
