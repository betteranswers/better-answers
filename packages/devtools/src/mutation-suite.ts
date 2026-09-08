import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { configDefaults, mergeConfig } from "vitest/config";
import type { ViteUserConfig } from "vitest/config";

/**
 * The suite as a mutation run sees it: the workspace's own vitest config, less the test
 * files that reach the workspace's `src` by no import, and so can kill no mutant.
 *
 * With vitest's `related` filter off (`stryker.config.mjs` says why), a mutant no test
 * covers per test runs the whole suite — and a workspace's suite holds tests that never
 * touch `src`: the ones that read the repository as a value, build a container image, or
 * run a tool over a throwaway tree. Each of those is a docker build or a tool run paid
 * once per static mutant for a verdict it cannot give. So the mutation run's vitest config
 * leaves them out, and the list is derived here rather than written down, because a
 * written list is one a new test file is missing from. `check` keeps running every file.
 *
 * A test reaches `src` when any import it makes, or any import a file it imports makes,
 * names a path under the workspace's `src` or the workspace's own package name (the
 * `exports` map is how a package's suite reaches its source). The reading is of the source
 * text — `import … from "…"`, `export … from "…"`, `import("…")` — and follows relative
 * specifiers through the workspace. It is conservative where it cannot read: a dynamic
 * import of anything but a string literal counts as reaching `src`, because leaving a test
 * out wrongly is a kill lost with nothing to say so.
 */

/** A specifier written in source: static, re-exported, or a dynamic import of a literal. */
const SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** A dynamic import whose target is not a literal, which the reading cannot follow. */
const UNREADABLE_IMPORT = /\bimport\s*\(\s*(?:\/\*[^*]*\*\/\s*)?[^"'\s)]/;

const testFilesUnder = (directory: string): readonly string[] =>
  readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((relative) => relative.endsWith(".test.ts"))
    .map((relative) => path.join(directory, relative));

/** The file a relative specifier names: as written, with `.ts`, or a directory's index. */
const resolveRelative = (from: string, specifier: string): string | undefined => {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
};

/**
 * The test files under `testsDirectory` (relative to `workspace`, posix-separated) that
 * reach `src` by no import, in path order.
 */
export const testsReachingNoSource = (
  workspace: string,
  testsDirectory: string,
  packageName: string,
): readonly string[] => {
  const source = path.join(workspace, "src") + path.sep;
  const reaching = new Map<string, boolean>();

  const reaches = (file: string, visiting: ReadonlySet<string>): boolean => {
    const known = reaching.get(file);
    if (known !== undefined) return known;
    if (visiting.has(file)) return false;
    const text = readFileSync(file, "utf8");
    if (UNREADABLE_IMPORT.test(text)) {
      reaching.set(file, true);
      return true;
    }
    const onward = new Set([...visiting, file]);
    let found = false;
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? "";
      if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
        found = true;
        break;
      }
      if (!specifier.startsWith(".")) continue;
      const target = resolveRelative(file, specifier);
      if (target === undefined) continue;
      if (target.startsWith(source) || reaches(target, onward)) {
        found = true;
        break;
      }
    }
    reaching.set(file, found);
    return found;
  };

  return testFilesUnder(path.join(workspace, testsDirectory))
    .filter((file) => !reaches(file, new Set()))
    .map((file) => path.relative(workspace, file).split(path.sep).join("/"))
    .sort((left, right) => left.localeCompare(right));
};

/**
 * `base` with the non-reaching test files excluded — what a workspace's
 * `vitest.mutation.config.ts` exports, and what its `stryker.config.mjs` names.
 */
export const mutationSuite = (
  base: ViteUserConfig,
  workspace: string,
  testsDirectory: string,
  packageName: string,
): ViteUserConfig =>
  mergeConfig(base, {
    test: {
      exclude: [
        ...configDefaults.exclude,
        ...testsReachingNoSource(workspace, testsDirectory, packageName),
      ],
    },
  });
