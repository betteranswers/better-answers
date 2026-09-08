import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Every TypeScript file under `packages/core/src`, for the suites that hold a rule over the
 * tree rather than over one function: the declared-acts walk, the guard that no audit door
 * is wrapped in `attempt`, and the count of the actor-naming door's callers.
 *
 * One walk rather than one per suite, so a file kind the walk misses is missed once and
 * found once — and so a suite reading the tree cannot quietly read a different tree from
 * its neighbour's.
 */

const CORE_SRC = path.resolve(import.meta.dirname, "../src");

/** The absolute path of every `.ts` file under `src`, at any depth. */
export const coreSourceFiles = (): readonly string[] =>
  readdirSync(CORE_SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name));

/** The same paths, written as a reader names them: `members/requests.ts`. */
export const asSliceRelative = (files: readonly string[]): readonly string[] =>
  files.map((file) => path.relative(CORE_SRC, file));

/**
 * The mark Stryker's instrumenter leaves in a file it has rewritten. The nightly mutation
 * run works in place — `stryker.config.mjs` says why — so while one is running the bytes
 * under `src` are the instrumenter's, not the ones this repository wrote.
 *
 * That matters to every gate above, because each reads the tree as *text*: the declared-acts
 * walk looks for `act("…")` and an instrumented literal is one it cannot see, so it fails on
 * the rewrite; the `attempt` guard looks for a shape the rewrite dissolves, so it passes on
 * one — and a check that has stopped being able to find what it hunts is the worse of the
 * two. Deciding per pattern which rewrites happen to survive is a judgement that ages with
 * the instrumenter, so all three ask this once and skip together. They hold where they were
 * always going to hold: `pnpm check`, on every pull request, over the tree as written.
 */
export const sourceTreeIsInstrumented = (): boolean =>
  coreSourceFiles().some((file) => /\bstry(?:NS|Cov|MutAct)_/.test(readFileSync(file, "utf8")));
