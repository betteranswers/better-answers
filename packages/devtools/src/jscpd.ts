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

const CLONE = /^\s*- (?<left>\S+) \[\d+:\d+ - \d+:\d+].*\n\s*(?<right>\S+) \[\d+:\d+ - \d+:\d+]/gm;

const clonesIn = (output: string): readonly Clone[] =>
  [...output.matchAll(CLONE)].map(({ groups }) => ({
    left: groups?.["left"] ?? "",
    right: groups?.["right"] ?? "",
  }));

export type JscpdRunner = (tree: Tree) => readonly Clone[];

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
