import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { repositoryRoot, workspacePackages } from "./paths.ts";

const manifest = z.looseObject({ scripts: z.record(z.string(), z.string()).default({}) });

export const rootScripts = (): Readonly<Record<string, string>> =>
  manifest.parse(JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")))
    .scripts;

const scriptWords = (name: string): readonly string[] =>
  (rootScripts()[name] ?? "").split(/\s+/u).filter((word) => word !== "");

const provableCommand = (name: string): readonly string[] => {
  const words = scriptWords(name);
  if (words.length < 2) throw new Error(`\`${name}\` is no command a reading of it could prove`);
  return words;
};

export const lintFlags = (): readonly string[] => {
  const [tool, ...flags] = scriptWords("lint");
  if (tool !== "oxlint") throw new Error(`\`lint\` no longer runs oxlint: ${String(tool)}`);
  return flags;
};

export const pythonGateChecker = (): string => {
  const [, checker] = provableCommand("comment-gate:python");
  if (checker === undefined || !checker.endsWith(".py")) {
    throw new Error("`comment-gate:python` runs no checker this reading can find");
  }
  return checker;
};

const workspaceManifest = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});
type WorkspaceManifest = z.infer<typeof workspaceManifest>;

const manifestOf = (directory: string): WorkspaceManifest =>
  workspaceManifest.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, directory, "package.json"), "utf8")),
  );

export const workspacesGated = (): readonly string[] =>
  workspacePackages().filter((directory) => manifestOf(directory).scripts?.["check"] !== undefined);

const RUNNER = /^node\s+(?:\.\.\/)*scripts\/check\.mjs\s+(?<gates>[\s\S]+)$/u;

const stepsNamed = (command: string): readonly string[] =>
  (RUNNER.exec(command.trim())?.groups?.["gates"] ?? "")
    .split(/\s+/u)
    .filter((gate) => gate !== "");

const expand = (command: string, seen: readonly string[]): readonly string[] =>
  stepsNamed(command).flatMap((gate) => {
    if (seen.includes(gate)) throw new Error(`${gate} is a step of itself: ${seen.join(" -> ")}`);

    const under = expand(rootScripts()[gate] ?? "", [...seen, gate]);
    return under.length === 0 ? [gate] : under;
  });

export const gatesNamed = (command: string): readonly string[] => expand(command, []);

const SCRIPT_RUN = /^pnpm\s+(?<script>[\w:@./-]+)$/u;

export const gatesUnder = (command: string): readonly string[] => {
  const script = SCRIPT_RUN.exec(command.trim())?.groups?.["script"];
  if (script === undefined) return [];

  const named = gatesNamed(rootScripts()[script] ?? "");
  return named.length === 0 ? [script] : named;
};

const FILTERED = /--filter\s+(?<workspace>\S+)/gu;
const ENTERED = /\bcd\s+(?<directory>[\w./-]+)/gu;

const RUNS_A_WHOLE_CHECK = /\bcheck$/u;

export const workspacesChecked = (command: string): readonly string[] => {
  if (!RUNS_A_WHOLE_CHECK.test(command.trim())) return [];

  const directoryOf = new Map(
    workspacePackages().map((directory) => [manifestOf(directory).name ?? directory, directory]),
  );

  return [
    ...[...command.matchAll(FILTERED)].flatMap(
      (found) => directoryOf.get(found.groups?.["workspace"] ?? "") ?? [],
    ),
    ...[...command.matchAll(ENTERED)].flatMap((found) => found.groups?.["directory"] ?? []),
  ];
};
