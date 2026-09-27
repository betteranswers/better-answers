import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { repositoryRoot, workspacePackages } from "@better-answers/devtools/paths";

/** Both fields are optional, so a manifest missing either reads as a workspace without it. */
const manifest = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});
type Manifest = z.infer<typeof manifest>;

const manifestOf = (directory: string): Manifest =>
  manifest.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, directory, "package.json"), "utf8")),
  );

export const rootScripts = (): Readonly<Record<string, string>> => manifestOf(".").scripts ?? {};

export const workspacesGated = (): readonly string[] =>
  workspacePackages().filter((directory) => manifestOf(directory).scripts?.["check"] !== undefined);

const RUNNER = /^node\s+(?:\.\.\/)*scripts\/check\.mjs\s+(?<gates>[\s\S]+)$/;

const stepsNamed = (command: string): readonly string[] =>
  (RUNNER.exec(command.trim())?.groups?.["gates"] ?? "").split(/\s+/).filter((gate) => gate !== "");

/**
 * A step that is itself a runner call stands for its own steps, so `check:gates` holds the
 * tree-walking gates once.
 */
const expand = (command: string, seen: readonly string[]): readonly string[] =>
  stepsNamed(command).flatMap((gate) => {
    // A script that reaches itself is a cycle, named here rather than left to the stack.
    if (seen.includes(gate)) throw new Error(`${gate} is a step of itself: ${seen.join(" -> ")}`);

    const under = expand(rootScripts()[gate] ?? "", [...seen, gate]);
    return under.length === 0 ? [gate] : under;
  });

/**
 * The leaf steps a runner call runs; none for any other command.
 * @throws on a cycle.
 */
export const gatesNamed = (command: string): readonly string[] => expand(command, []);

const SCRIPT_RUN = /^pnpm\s+(?<script>[\w:@./-]+)$/;

/** A workflow step names one root script; a script that is a runner call stands for its steps. */
export const gatesUnder = (command: string): readonly string[] => {
  const script = SCRIPT_RUN.exec(command.trim())?.groups?.["script"];
  if (script === undefined) return [];

  const named = gatesNamed(rootScripts()[script] ?? "");
  return named.length === 0 ? [script] : named;
};

const FILTERED = /--filter\s+(?<workspace>\S+)/g;
const ENTERED = /\bcd\s+(?<directory>[\w./-]+)/g;

/** A command that ends in a named file runs that file, not the workspace's whole suite. */
const RUNS_A_WHOLE_CHECK = /\bcheck$/;

/** A pnpm workspace is named by its package, the worker's uv one by being stepped into. */
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
