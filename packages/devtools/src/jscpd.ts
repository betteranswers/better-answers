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

  ...(config.ignore.length > 0 ? ["--ignore", config.ignore.join(",")] : []),
  "--reporters",
  "console",
  "--no-colors",
  ...config.paths,
];

export type Clone = { readonly left: string; readonly right: string };

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
