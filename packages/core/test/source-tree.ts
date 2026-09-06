import { readdirSync } from "node:fs";
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
