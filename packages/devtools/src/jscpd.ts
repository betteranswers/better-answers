import { runsOverThrowawayTree } from "./throwaway-tree.ts";
import type { Tree } from "./throwaway-tree.ts";

export type { Tree } from "./throwaway-tree.ts";

export type JscpdConfig = {
  readonly paths: readonly string[];

  readonly formats: readonly string[];

  readonly minLines: number;
  readonly minTokens: number;

  readonly threshold: number;

  readonly ignore: readonly string[];
};

/**
 * A command line, never jscpd's own config file: it reports a config it could not parse,
 * then scans on its defaults and exits zero.
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

  // Omitted, never passed empty: jscpd reads an empty ignore as every path, and a tree it
  // scanned nothing of looks clean.
  ...(config.ignore.length > 0 ? ["--ignore", config.ignore.join(",")] : []),
  "--reporters",
  "console",
  "--no-colors",
  ...config.paths,
];

type Clone = { readonly left: string; readonly right: string };

const clonesIn = (output: string): readonly Clone[] => {
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

export type JscpdRunner = (tree: Tree) => readonly Clone[];

/** The smoke tree must report exactly `smoke.clones` clones. */
export const jscpdOver = (
  config: JscpdConfig,
  smoke: { readonly tree: Tree; readonly clones: number },
): JscpdRunner => {
  const run = runsOverThrowawayTree({
    executable: { package: "jscpd", path: ["run-jscpd.js"] },
    argv: jscpdArgv(config),

    foundSomething: [1],
    smoke: {
      tree: smoke.tree,
      reports: (output) => clonesIn(output).length === smoke.clones,
    },
  });

  return (tree) => clonesIn(run(tree));
};
