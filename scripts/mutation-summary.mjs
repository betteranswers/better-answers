import { mutationSummaryFromArgv } from "../packages/devtools/src/mutation-summary.ts";

const { summary, fault } = mutationSummaryFromArgv(process.argv.slice(2));
process.stdout.write(summary);
if (fault !== undefined) {
  process.stderr.write(`${fault}\n`);
  process.exitCode = 1;
}
