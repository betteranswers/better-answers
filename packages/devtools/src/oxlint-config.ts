import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const ruleSetting = z.union([z.string(), z.tuple([z.string()], z.unknown())]);

// The keys the suites read; a key that stopped being there fails here, by name.
const oxlintConfig = z.object({
  rules: z.record(z.string(), ruleSetting),
  overrides: z.array(
    z.object({
      files: z.array(z.string()).optional(),
      rules: z.record(z.string(), ruleSetting).optional(),
    }),
  ),
  jsPlugins: z.array(z.object({ name: z.string(), specifier: z.string() })),

  plugins: z.array(z.string()),
  options: z.record(z.string(), z.unknown()).optional(),

  categories: z.record(z.string(), z.string()),
});

export type OxlintConfig = z.infer<typeof oxlintConfig>;

export const readOxlintConfig = (): OxlintConfig =>
  oxlintConfig.parse(
    JSON.parse(
      readFileSync(path.join(repositoryRoot, ".oxlintrc.json"), "utf8").replaceAll(
        // Whole-line comments only: a wider match would swallow a `//` inside a string, such
        // as a URL.
        /^\s*\/\/.*$/gm,
        "",
      ),
    ),
  );

// The specifier is read off the real config, so a plugin that stopped loading fails the case
// rather than leaving every rule under it silent.
export const pluginConfigFor = (rules: Readonly<Record<string, string>>): string => {
  const plugin = readOxlintConfig().jsPlugins.find((one) => one.name === "better-answers");
  if (plugin === undefined) {
    throw new Error(".oxlintrc.json no longer loads the better-answers plugin.");
  }
  return JSON.stringify({
    jsPlugins: [{ name: plugin.name, specifier: path.join(repositoryRoot, plugin.specifier) }],
    rules,
  });
};

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
