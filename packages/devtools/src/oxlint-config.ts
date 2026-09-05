import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The repository's own `.oxlintrc.json`, read as a value.
 *
 * Three suites — the api's rules, the SPA's zones and core's import direction — each run
 * oxlint over a throwaway tree under the *real* config rather than a restatement of it, so
 * that a suite cannot pass while the config it is describing is broken. Each of them was
 * reading the file the same way, and three readers of one file drift: the comment-stripping
 * regex below is the part that would have gone wrong quietly, because a reader that misses a
 * comment throws on JSON it cannot parse in one suite and not the other two.
 */

/** The repository root, from this package's own location in it. */
export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

/**
 * How oxlint writes a rule's setting: a severity on its own, or a severity followed by the
 * rule's own options, whose shape is that rule's and not this module's to know.
 */
type RuleSetting = string | readonly [string, ...unknown[]];

/** The shape the suites read out of the config. Every field is one they assert on. */
export type OxlintConfig = {
  readonly rules: Readonly<Record<string, RuleSetting>>;
  readonly overrides: readonly {
    readonly files?: readonly string[];
    readonly rules?: Readonly<Record<string, RuleSetting>>;
  }[];
  readonly jsPlugins: readonly { readonly name: string; readonly specifier: string }[];
  /** The built-in plugin list and the options block: a rule run alone still needs both. */
  readonly plugins: readonly string[];
  readonly options?: Readonly<Record<string, unknown>>;
};

/**
 * The config, with its comments removed.
 *
 * oxlint accepts JSONC and the repository's config uses it: every rule in there carries the
 * reason it is on. `JSON.parse` does not, so the `//` lines are stripped before the parse —
 * whole-line comments only, which is the form the config uses, and the form that cannot
 * swallow a `//` inside a string such as a URL.
 */
export const readOxlintConfig = (): OxlintConfig =>
  // SAFETY: the shape asserted is this repository's own config file. A key that stopped
  // being there fails in the suite that names it, and a file that is not JSON at all throws
  // in the parse itself — neither can reach a caller as a quietly empty config.
  JSON.parse(
    readFileSync(path.join(repositoryRoot, ".oxlintrc.json"), "utf8").replaceAll(
      /^\s*\/\/.*$/gm,
      "",
    ),
  ) as OxlintConfig;

/**
 * The override declaring exactly `glob`, or a throw naming it.
 *
 * A suite that read `undefined` here would build a throwaway config missing the very rule it
 * is about to assert on, and then read oxlint's silence as the rule staying quiet.
 */
export const oxlintOverrideFor = (glob: string): OxlintConfig["overrides"][number] => {
  const found = readOxlintConfig().overrides.find((override) => override.files?.includes(glob));
  if (found === undefined) throw new Error(`no override for ${glob} in .oxlintrc.json`);
  return found;
};
