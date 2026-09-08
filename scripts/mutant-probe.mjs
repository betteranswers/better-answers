/**
 * The mutant probe: one hand-applied mutation, run against a workspace's suite, restored in a
 * `finally` on every path, then the `src` diff-stat against HEAD.
 *
 *   node scripts/mutant-probe.mjs --file <path> --line <n> --from <text> --to <text>
 *                                 [--suite <vitest filter>] [--timeout-ms <n>]
 *
 * Every decision — what counts as a verdict, when the probe refuses to start, how an
 * interrupt reaches the suite — lives in packages/devtools, the way the copy gate's does, so
 * the suite that proves it and this entry point run the same code.
 */

import { mutantProbe } from "../packages/devtools/src/mutant-probe.ts";

process.exit(await mutantProbe(process.argv.slice(2)));
