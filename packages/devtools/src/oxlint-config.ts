import { readFileSync } from "node:fs";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

type RuleSetting = string | readonly [string, ...unknown[]];

export type OxlintConfig = {
  readonly rules: Readonly<Record<string, RuleSetting>>;
  readonly overrides: readonly {
    readonly files?: readonly string[];
    readonly rules?: Readonly<Record<string, RuleSetting>>;
  }[];
  readonly jsPlugins: readonly { readonly name: string; readonly specifier: string }[];

  readonly plugins: readonly string[];
  readonly options?: Readonly<Record<string, unknown>>;

  readonly categories: Readonly<Record<string, string>>;
};

export const readOxlintConfig = (): OxlintConfig =>
  // SAFETY: a key that stopped being there fails the suite that names it, and a file that is
  // not JSON throws in the parse itself.
  JSON.parse(
    readFileSync(path.join(repositoryRoot, ".oxlintrc.json"), "utf8").replaceAll(
      // Whole-line comments only: a wider match would swallow a `//` inside a string, such
      // as a URL.
      /^\s*\/\/.*$/gm,
      "",
    ),
  ) as OxlintConfig;

type GlobbedOverride = OxlintConfig["overrides"][number] & {
  readonly files: readonly string[];
};

export const oxlintOverrideFor = (glob: string): GlobbedOverride => {
  const found = readOxlintConfig().overrides.find(
    (override): override is GlobbedOverride => override.files?.includes(glob) === true,
  );
  if (found === undefined) throw new Error(`no override for ${glob} in .oxlintrc.json`);
  return found;
};
