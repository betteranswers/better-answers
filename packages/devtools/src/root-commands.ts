import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const manifest = z.looseObject({ scripts: z.record(z.string(), z.string()).default({}) });

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

export const rootScripts = (): Readonly<Record<string, string>> =>
  manifest.parse(JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")))
    .scripts;

const wordsOf = (name: string): readonly string[] => {
  const words = (rootScripts()[name] ?? "").split(/\s+/).filter((word) => word !== "");
  if (words.length < 2) throw new Error(`\`${name}\` is no command a reading of it could prove`);
  return words;
};

export const typeScriptGateArgv = (): readonly string[] => {
  const [tool, ...rest] = wordsOf("comment-gate:ts");
  if (tool !== "oxlint")
    throw new Error(`\`comment-gate:ts\` no longer runs oxlint: ${String(tool)}`);
  return rest;
};

export const typeScriptGateConfig = (): string => {
  const argv = typeScriptGateArgv();
  const named = argv[argv.indexOf("--config") + 1];
  if (!argv.includes("--config") || named === undefined) {
    throw new Error("`comment-gate:ts` names no --config, so a reading of it proves nothing.");
  }
  return named;
};

// A root is a path a gate hands its tool to walk, which the tool's own name, its config and
// the checker's path are not.
export const commentGateRoots = (): readonly string[] => {
  const config = typeScriptGateConfig();
  const typescript = typeScriptGateArgv().filter((word) => word !== "--config" && word !== config);
  const [, checker, ...python] = wordsOf("comment-gate:python");
  if (checker === undefined || !checker.endsWith(".py")) {
    throw new Error("`comment-gate:python` runs no checker this reading can find");
  }
  return [...new Set([...typescript, ...python])].sort();
};
