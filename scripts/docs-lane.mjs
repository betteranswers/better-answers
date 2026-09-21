/**
 * Which lane a change runs `check` in: `docs` when everything it touched is prose, `full`
 * otherwise. Reads the changed paths on standard input, one per line or NUL-separated, and
 * writes the lane on standard output.
 *
 * The process review of 21/09/2026 measured a five-file markdown pull request paying the
 * same 11 minutes of `check` as a change to the tier code, and then 13 more on main. The
 * lane is what makes those two different prices. It is a separate decision from *which*
 * gates a lane runs — that is the root `check:docs` script — so that the rule can be read
 * and tested as what it is: a function from paths to a word.
 *
 * THE RULE, and it holds in one direction only. A change is `docs` when it has at least one
 * changed path and EVERY changed path ends in `.md`. Everything else is `full`, and that
 * asymmetry is the whole design: `full` is the lane this repository already ran, so being
 * wrong about a change in that direction costs minutes, and being wrong the other way ships
 * a tree no gate read. So an empty list is `full` (a diff that resolved to nothing is a diff
 * nobody has read, not a change to nothing), and the caller resolves anything it cannot
 * answer — an all-zero `before`, a base it could not fetch, an event with no base at all —
 * to `full` without asking here.
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

/** The decision, and the only thing in this file worth testing. */
const laneOf = (paths) =>
  paths.length > 0 && paths.every((changed) => changed.endsWith(".md")) ? "docs" : "full";

/**
 * Both separators, because the caller has a reason to use either: `git diff -z` writes NUL
 * so that a path with a newline or a quote in it survives, and a person running this by hand
 * types lines. ONE OR THE OTHER, never both — splitting a NUL stream on newlines too would
 * read the path `-z` exists to carry as two paths, and two paths that are not markdown.
 */
const changedPaths = (raw) =>
  raw.split(raw.includes("\0") ? "\0" : "\n").filter((changed) => changed.length > 0);

process.stdout.write(`${laneOf(changedPaths(readFileSync(0, "utf8")))}\n`);
