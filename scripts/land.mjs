/**
 * The landing command: the working tree's changes and one sentence become a branch, a commit,
 * a push, an open pull request and an armed auto-merge, with the queue state read back.
 *
 *   pnpm land --message "<a sentence saying what changed, a ticket id last in brackets>"
 *
 * It exists so that a one-line change costs no more than a direct push to `main` did, since a
 * commit that reaches `main` outside the queue rebuilds every entry already in it.
 *
 * Every decision — what the repository's prose shape is, when the command refuses, how the
 * queue state is read — lives in packages/devtools, the way the mutant probe's does, so the
 * suite that proves it and this entry point run the same code.
 */

import { land } from "../packages/devtools/src/land.ts";

process.exit(land(process.argv.slice(2)));
