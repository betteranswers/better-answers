import { mutationSummaryFromArgv } from "../packages/devtools/src/mutation-summary.ts";

process.stdout.write(mutationSummaryFromArgv(process.argv.slice(2)));
