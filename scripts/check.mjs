/**
 * `check` for a TypeScript workspace and for the root: run every step named on the command
 * line, even after one fails, and end by naming all of them.
 *
 * Each argument is a script in the manifest of the directory this runs in, so a manifest's
 * `check` reads as the list of gates that workspace has and adding one is a word. The
 * failures are collected rather than thrown at the first, because a session that is told
 * only about lint fixes lint, runs `check` again, and is then told about types — three runs
 * of a browser suite to learn three things.
 *
 * pnpm can select scripts by regular expression and `--no-bail` will keep going past a
 * failure, but as of pnpm 11.24.0 that combination exits 0 with failed scripts behind it,
 * which is the silent pass this file exists to refuse. `pnpm -r --no-bail` — the recursive
 * form the root uses over the workspaces — does report a non-zero exit, and is unaffected.
 *
 * The worker's equivalent is `apps/worker/src/better_answers_worker/check.py`; the two are
 * separate because a uv workspace is not a pnpm one and neither tier can run the other's.
 */

import { spawnSync } from "node:child_process";

const steps = process.argv.slice(2);

if (steps.length === 0) {
  process.stderr.write("check: name at least one script to run\n");
  process.exit(2);
}

const failed = [];

for (const step of steps) {
  process.stdout.write(`\n== ${step} ==\n`);
  const { status, error } = spawnSync("pnpm", ["run", step], { stdio: "inherit" });
  if (error !== undefined || status !== 0) failed.push(step);
}

if (failed.length > 0) {
  process.stderr.write(`\ncheck failed: ${failed.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write("\ncheck passed\n");
