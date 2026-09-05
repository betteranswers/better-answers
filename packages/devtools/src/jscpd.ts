import { runsOverThrowawayTree } from "./throwaway-tree.ts";
import type { Tree } from "./throwaway-tree.ts";

export type { Tree } from "./throwaway-tree.ts";

/**
 * jscpd as one command line, built in one place.
 *
 * The repository's own values live in `jscpd.config.mjs` at the root, where each exclusion
 * carries the reason it is there; this module turns a set of those values into the argument
 * list jscpd takes, so `scripts/jscpd.mjs` — the gate — and the suite that proves the gate
 * fires are running the same tool the same way.
 *
 * It is a command line rather than jscpd's own `.jscpd.json` because that file is parsed
 * strictly and, when the parse fails, jscpd reports the failure and then scans on its
 * defaults and exits zero: a config nobody could read is indistinguishable from a tree with
 * no clones in it. There is no config file to misread here.
 */

/** What a jscpd run needs to know. Mirrors the names jscpd's own config uses. */
export type JscpdConfig = {
  /** Where to look, relative to the directory jscpd runs in. */
  readonly paths: readonly string[];
  /** jscpd's format names (`jscpd --list`), not file extensions. */
  readonly formats: readonly string[];
  /** The smallest clone worth reporting. */
  readonly minLines: number;
  readonly minTokens: number;
  /** The duplication percentage tolerated before jscpd exits non-zero. */
  readonly threshold: number;
  /** File-level globs jscpd never reads. */
  readonly ignore: readonly string[];
};

/**
 * `config` as jscpd's argument list.
 *
 * The reporter is pinned to `console` with colours off: it is the one reporter that writes
 * every clone it found to stdout as `path [start - end]` lines, with no report directory to
 * clean up afterwards, and without the ANSI escapes that would sit between a reader — a
 * person or the assertion below — and the path.
 */
export const jscpdArgv = (config: JscpdConfig): readonly string[] => [
  "--min-lines",
  String(config.minLines),
  "--min-tokens",
  String(config.minTokens),
  "--threshold",
  String(config.threshold),
  "--format",
  config.formats.join(","),
  // Omitted rather than passed empty: jscpd reads `--ignore ""` as a pattern that matches
  // every path, and answers a tree it scanned nothing of exactly as it answers a clean one.
  ...(config.ignore.length > 0 ? ["--ignore", config.ignore.join(",")] : []),
  "--reporters",
  "console",
  "--no-colors",
  ...config.paths,
];

/** The clone jscpd reports: the file each of its two halves is in. */
export type Clone = { readonly left: string; readonly right: string };

/**
 * The clones a console report names, as pairs of paths.
 *
 * jscpd writes each clone as a `Clone found (format)` heading, then the two fragments as
 * ` - <path> [l:c - l:c]` and `   <path> [l:c - l:c]`. The lines are read rather than the
 * statistics table, because the table's "Clones found" column is a number and a caller that
 * asserted on it could not say *which* files a gate stopped being blind to.
 */
export const clonesIn = (output: string): readonly Clone[] => {
  const fragment = /^\s*(?:- )?(?<file>\S+) \[\d+:\d+ - \d+:\d+]/;
  const files = output
    .split("\n")
    .map((line) => fragment.exec(line)?.groups?.["file"])
    .filter((file): file is string => file !== undefined);
  const clones: Clone[] = [];
  for (let index = 0; index + 1 < files.length; index += 2) {
    // SAFETY: the loop condition holds both indices inside the array, and
    // `noUncheckedIndexedAccess` cannot see that.
    clones.push({ left: files[index] ?? "", right: files[index + 1] ?? "" });
  }
  return clones;
};

/** jscpd over a throwaway tree: the clones it found, or none. */
export type JscpdRunner = (tree: Tree) => readonly Clone[];

/**
 * Build a runner that scans a throwaway tree with `config`.
 *
 * The smoke case is a tree that must produce a clone, and it is not optional: jscpd exits
 * zero for a tree it found nothing in *and* for one it refused to scan — an unknown format
 * name, a path that matched no file, an ignore glob that swallowed everything — so without
 * one, every "and this stays silent" assertion below would pass against a tool that never
 * read a line.
 */
export const jscpdOver = (
  config: JscpdConfig,
  smoke: { readonly tree: Tree; readonly clones: number },
): JscpdRunner => {
  const run = runsOverThrowawayTree({
    executable: { package: "jscpd", path: ["run-jscpd.js"] },
    argv: jscpdArgv(config),
    // jscpd's own "I found duplication over the threshold" exit.
    foundSomething: [1],
    smoke: {
      tree: smoke.tree,
      reports: (output) => clonesIn(output).length === smoke.clones,
    },
  });

  return (tree) => clonesIn(run(tree));
};
