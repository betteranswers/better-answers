/**
 * The mutation run's job summary: one leg's score, its new survivors against the previous
 * run's report, and the rows the runner never tested, as markdown on stdout.
 *
 *   node scripts/mutation-summary.mjs --leg <name> --report <path> [--baseline <path>]
 *
 * Every decision — what a survivor is, how a mutant is matched across two reports, what is
 * said when a file is absent — lives in packages/devtools, the way the mutant probe's does,
 * so the suite that proves it and this entry point run the same code. The exit is zero
 * whatever the reports hold: the summary never gates.
 */

import { mutationSummaryFromArgv } from "../packages/devtools/src/mutation-summary.ts";

process.stdout.write(mutationSummaryFromArgv(process.argv.slice(2)));
