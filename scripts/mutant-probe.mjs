import { mutantProbe } from "../packages/devtools/src/mutation/mutant-probe.ts";

process.exit(await mutantProbe(process.argv.slice(2)));
