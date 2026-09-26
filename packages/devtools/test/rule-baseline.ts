import { readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

type RuleBaseline = {
  readonly refusedFiles: (tree: Tree) => readonly string[];
};

type Smoke = { readonly tree: Tree; readonly flagged: readonly string[] };

/** oxlint reports a core rule under `eslint`, and a core rule needs no plugin switched on. */
const partsOf = (rule: string): { readonly plugin: string; readonly name: string } => {
  const slash = rule.indexOf("/");
  return slash === -1
    ? { plugin: "eslint", name: rule }
    : { plugin: rule.slice(0, slash), name: rule.slice(slash + 1) };
};

/** Lints fixture trees under `rule` as the root config sets it, its overrides included. */
export const ruleBaseline = (rule: string, smoke: Smoke): RuleBaseline => {
  const { plugin, name } = partsOf(rule);
  const config = readOxlintConfig();
  const overrides = config.overrides.flatMap((override) => {
    const setting = override.rules?.[rule];
    return setting === undefined
      ? []
      : [{ files: override.files ?? [], rules: { [rule]: setting } }];
  });

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

  return { refusedFiles };
};
