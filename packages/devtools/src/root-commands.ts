import { readFileSync } from "node:fs";
import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";
import { z } from "zod";

const manifest = z.looseObject({ scripts: z.record(z.string(), z.string()).default({}) });

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

export const rootScripts = (): Readonly<Record<string, string>> =>
  manifest.parse(JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")))
    .scripts;

const scriptWords = (name: string): readonly string[] =>
  (rootScripts()[name] ?? "").split(/\s+/).filter((word) => word !== "");

const provableCommand = (name: string): readonly string[] => {
  const words = scriptWords(name);
  if (words.length < 2) throw new Error(`\`${name}\` is no command a reading of it could prove`);
  return words;
};

/** The root `lint` script's words after `oxlint`; throws when it runs another tool. */
export const lintFlags = (): readonly string[] => {
  const [tool, ...flags] = scriptWords("lint");
  if (tool !== "oxlint") throw new Error(`\`lint\` no longer runs oxlint: ${String(tool)}`);
  return flags;
};

/**
 * The paths `comment-gate:python` hands its checker, once each and sorted; throws when it
 * names no `.py` checker.
 */
export const pythonGateRoots = (): readonly string[] => {
  const [, checker, ...roots] = provableCommand("comment-gate:python");
  if (checker === undefined || !checker.endsWith(".py")) {
    throw new Error("`comment-gate:python` runs no checker this reading can find");
  }
  return [...new Set(roots)].sort(byCodeUnit);
};
