/**
 * Which lane a change runs `check` in, and whether the worker's gates are in it. Reads the
 * changed paths on standard input, one per line or NUL-separated, and writes two `key=value`
 * lines on standard output in the form `$GITHUB_OUTPUT` takes:
 *
 *     lane=docs|affected|full
 *     worker=yes|no
 *
 * The process review of 21/09/2026 measured a five-file markdown pull request paying the
 * same 11 minutes of `check` as a change to the tier code, and then 13 more on main. The
 * lane is what makes those two different prices. It is a separate decision from *which*
 * gates a lane runs — that is the root `check:docs`, `check:gates` and `check:affected`
 * scripts — so that the rule can be read and tested as what it is: a function from paths to
 * two words.
 *
 * THE THREE LANES, and the asymmetry between them is the whole design. `full` is the lane
 * this repository already ran, so being wrong in that direction costs minutes and being
 * wrong the other way ships a tree no gate read. Every rule below therefore falls to `full`
 * the moment it is unsure.
 *
 *   `docs`     — at least one changed path, and EVERY changed path ends in `.md`. The prose
 *                gates, and nothing else.
 *   `affected` — no changed path ends in `.md`, and every one of them lies inside a workspace
 *                this repository has. Those are the paths `pnpm --filter "...[<base>]"` can
 *                answer for, so the root gates run and the workspaces come from the filter.
 *   `full`     — everything else, and that is most of what is not one of the two above: no
 *                paths at all, a root file no workspace owns (`package.json`, the lockfile,
 *                a workflow), `contracts/`, and any change that mixes prose with code.
 *
 * WHY PROSE WITH CODE IS `full`. The suites that read this repository's documents live in
 * `apps/api`, `apps/web` and `packages/core` — `apps/web/CODING_RULES.md` is read by
 * `apps/api/tests/coding-rules-form.test.ts` — so a filter that named `apps/web` for a
 * change to that file would run every gate except the one coupled to it. The docs lane runs
 * those suites by name; the affected lane cannot, so it refuses the change.
 *
 * WHY `contracts/` IS `full`. Both tiers' suites read it and no pnpm workspace owns a line of
 * it, so the filter selects nothing for it and the TypeScript half of the tier contract —
 * `packages/core/test/tier-contract.test.ts` — would not run. A change there is both tiers'
 * and takes the lane that runs both.
 *
 * `endsWith(".md")` and nothing looser. `.mdx` is not markdown this repository's prose gates
 * read, `notes.md.ts` is TypeScript, and a path with `.md` somewhere in the middle is
 * whatever its own extension says it is: each of those is `full`, and each is a case in
 * `apps/api/tests/docs-lane.test.ts`. A rename is two paths under `--no-renames`, which is
 * how a markdown file renamed to a `.ts` stays `full`.
 *
 * Not the lane's business: a docs-only change that breaks a gate. It happened on 21/09/2026
 * — five markdown files moved and `apps/api/tests/coding-rules-tags.test.ts` went red on the
 * three `CITED_NOWHERE_ELSE` entries they made stale — which is the reason the docs lane
 * runs the prose-reading suites rather than skipping CI.
 */

import { readFileSync } from "node:fs";

const isMarkdown = (changed) => changed.endsWith(".md");

/**
 * Every workspace this repository has — `pnpm-workspace.yaml`'s six and the uv workspace
 * `apps/worker` — named rather than matched by `apps/*`, because a directory that only LOOKS
 * like a workspace is the one way this lane could be silently green: pnpm would map its files
 * to the workspace root, the exclusion below would drop that, and the leg would pass having
 * run nothing. An unknown directory is `full`. The list is held against `workspacePackages()`
 * by `apps/api/tests/docs-lane.test.ts`, so a workspace added and not named here is red.
 */
const WORKSPACE_ROOTS = [
  "apps/api/",
  "apps/web/",
  "apps/worker/",
  "packages/core/",
  "packages/design-system/",
  "packages/devtools/",
  "packages/schema/",
];

const ownedByAWorkspace = (changed) => WORKSPACE_ROOTS.some((root) => changed.startsWith(root));

/**
 * The two roots the worker's own suites read, and neither is a pnpm workspace. `contracts/`
 * takes the full lane by the rule above, so today only the first arm is ever acted on; both
 * are named so that this tier's whole coupling is in one place rather than half here and half
 * in a rule about somewhere else.
 */
const THE_WORKER_READS = ["apps/worker/", "contracts/"];

/** The decision, and the first of the two things in this file worth testing. */
const laneOf = (paths) => {
  if (paths.length === 0) return "full";
  if (paths.every(isMarkdown)) return "docs";

  return paths.every((changed) => !isMarkdown(changed) && ownedByAWorkspace(changed))
    ? "affected"
    : "full";
};

/**
 * The second. `pnpm --filter` never names the worker — a uv workspace is not a pnpm one — so
 * the one leg that runs its gates is told by this rather than by the filter. An empty list is
 * `yes` for the reason the lane is `full`: a diff that resolved to nothing is a diff nobody
 * has read, not a change to nothing.
 */
const workerOf = (paths) =>
  paths.length === 0 ||
  paths.some((changed) => THE_WORKER_READS.some((root) => changed.startsWith(root)))
    ? "yes"
    : "no";

/**
 * Both separators, because the caller has a reason to use either: `git diff -z` writes NUL
 * so that a path with a newline or a quote in it survives, and a person running this by hand
 * types lines. ONE OR THE OTHER, never both — splitting a NUL stream on newlines too would
 * read the path `-z` exists to carry as two paths, and two paths that are not markdown.
 */
const changedPaths = (raw) =>
  raw.split(raw.includes("\0") ? "\0" : "\n").filter((changed) => changed.length > 0);

const changed = changedPaths(readFileSync(0, "utf8"));

process.stdout.write(`lane=${laneOf(changed)}\nworker=${workerOf(changed)}\n`);
