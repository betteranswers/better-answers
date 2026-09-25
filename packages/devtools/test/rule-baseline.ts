import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { readOxlintConfig, repositoryRoot } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { expect } from "vitest";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

type RuleBaseline = {
  readonly listed: readonly string[];
  readonly onTheList: () => string;
  readonly refusedFiles: (tree: Tree) => readonly string[];
  readonly gone: () => readonly string[];
  readonly cleared: () => readonly string[];
};

type Smoke = { readonly tree: Tree; readonly flagged: readonly string[] };

/** oxlint reports a core rule under `eslint`, and a core rule needs no plugin switched on. */
const partsOf = (rule: string): { readonly plugin: string; readonly name: string } => {
  const slash = rule.indexOf("/");
  return slash === -1
    ? { plugin: "eslint", name: rule }
    : { plugin: rule.slice(0, slash), name: rule.slice(slash + 1) };
};

export const ruleBaseline = (rule: string, smoke: Smoke): RuleBaseline => {
  const { plugin, name } = partsOf(rule);
  const config = readOxlintConfig();
  const overrides = config.overrides.flatMap((override) => {
    const setting = override.rules?.[rule];
    return setting === undefined
      ? []
      : [{ files: override.files ?? [], rules: { [rule]: setting } }];
  });
  const listed = overrides.flatMap((override) => override.files);

  /** Read off the root config, so a setting it loosens or an exemption it widens fails here. */
  const lint = oxlintOver(
    JSON.stringify({
      plugins: plugin === "eslint" ? undefined : [plugin],
      rules: { [rule]: config.rules[rule] },
      overrides,
    }),
    smoke,
  );
  const refused = new RegExp(`^(?<file>[^\\s:]+):\\d+:\\d+: .*\\[Error/${plugin}\\(${name}\\)\\]$`);

  const refusedFiles = (tree: Tree): readonly string[] =>
    [
      ...new Set(
        lint
          .output(tree)
          .split("\n")
          .flatMap((line) => refused.exec(line)?.groups?.["file"] ?? []),
      ),
    ].sort();

  const onTheList = (): string => {
    const [first] = listed;
    expect(
      first,
      "the baseline list is empty: delete its override from .oxlintrc.json and the cases reading it.",
    ).toBeDefined();
    return first ?? "";
  };

  const present = (file: string): boolean => existsSync(path.join(repositoryRoot, file));

  /** Each listed file is copied under a path no override names, so the rule reads it as new. */
  const cleared = (): readonly string[] => {
    const moved = (file: string): string => path.posix.join("unlisted", file);
    const kept = listed.filter(present);
    const tree = Object.fromEntries(
      kept.map((file) => [moved(file), readFileSync(path.join(repositoryRoot, file), "utf8")]),
    );
    const stillRefused = refusedFiles(tree);
    return kept.filter((file) => !stillRefused.includes(moved(file)));
  };

  return {
    listed,
    onTheList,
    refusedFiles,
    gone: () => listed.filter((file) => !present(file)),
    cleared,
  };
};
