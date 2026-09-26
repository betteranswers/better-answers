import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { z } from "zod";

import { repositoryRoot } from "./paths.ts";

const ruleSetting = z.union([z.string(), z.tuple([z.string()], z.unknown())]);

/** The keys the suites read; a key that stopped being there fails here, by name. */
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

type RuleSetting = z.infer<typeof ruleSetting>;

type JsPlugin = OxlintConfig["jsPlugins"][number];

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

const requireFromRoot = createRequire(path.join(repositoryRoot, "package.json"));

/** oxlint resolves a specifier from the config's directory, and a throwaway tree has no `node_modules`. */
export const loadableAnywhere = (plugin: JsPlugin): JsPlugin => ({
  ...plugin,
  specifier: plugin.specifier.startsWith(".")
    ? path.join(repositoryRoot, plugin.specifier)
    : requireFromRoot.resolve(plugin.specifier),
});

/**
 * The specifier is read off the real config, so a plugin that stopped loading fails the case
 * rather than leaving every rule under it silent.
 */
export const pluginConfigFor = (rules: Readonly<Record<string, RuleSetting>>): string => {
  const named = new Set(Object.keys(rules).map((rule) => rule.split("/")[0] ?? rule));
  const plugins = readOxlintConfig().jsPlugins.filter((one) => named.has(one.name));
  const missing = [...named].filter((name) => !plugins.some((one) => one.name === name));
  if (missing.length > 0) {
    throw new Error(`.oxlintrc.json loads no JS plugin named ${missing.join(", ")}.`);
  }
  return JSON.stringify({ jsPlugins: plugins.map(loadableAnywhere), rules });
};

type GlobbedOverride = OxlintConfig["overrides"][number] & {
  readonly files: readonly string[];
};

/** The first override whose `files` holds `glob` verbatim; throws when none does. */
export const oxlintOverrideFor = (glob: string): GlobbedOverride => {
  const found = readOxlintConfig().overrides.find(
    (override): override is GlobbedOverride => override.files?.includes(glob) === true,
  );
  if (found === undefined) throw new Error(`no override for ${glob} in .oxlintrc.json`);
  return found;
};
