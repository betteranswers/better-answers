import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";

const PACKAGES_BLOCK = /^packages:\n((?:[ \t]*-[ \t]+\S+[ \t]*\n)+)/m;

/** The workspace directories pnpm-workspace.yaml names, relative to the root and sorted. */
export const workspacePackages = (): readonly string[] => {
  const file = readFileSync(path.join(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  const block = PACKAGES_BLOCK.exec(file)?.[1];
  if (block === undefined) throw new Error("pnpm-workspace.yaml has no `packages:` list");

  const patterns = block
    .split("\n")
    .map((line) =>
      line
        .replace(/^[ \t]*-[ \t]+/, "")
        .trim()
        .replace(/^["']|["']$/g, ""),
    )
    .filter((entry) => entry.length > 0);

  const expand = (pattern: string): readonly string[] => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(path.join(repositoryRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  };

  return patterns
    .flatMap(expand)
    .filter((project) => existsSync(path.join(repositoryRoot, project, "package.json")))
    .sort();
};

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

/** pnpm's own name for the workspace root, which is a project like any other to `--filter`. */
export const rootName = (): string => manifestOf(".").name ?? "";

/** By directory, where `workspacesWithNoCheck` answers by package name. */
export const workspacesGated = (): readonly string[] =>
  workspacePackages().filter((directory) => manifestOf(directory).scripts?.["check"] !== undefined);

/** By package name, which is how a filter names one: a selection of these alone runs no gate. */
export const workspacesWithNoCheck = (): readonly string[] =>
  workspacePackages()
    .filter((directory) => manifestOf(directory).scripts?.["check"] === undefined)
    .map((directory) => manifestOf(directory).name ?? directory);

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

/**
 * `...[<ref>]` names no workspace, so the widest answer it could give is the one to hold a leg's
 * setup and its variables against.
 */
const CHANGED_SINCE = /--filter\s+"?\.\.\.\[[^\]]*\]"?/;

/** A pnpm workspace is named by its package, the worker's uv one by being stepped into. */
export const workspacesChecked = (command: string): readonly string[] => {
  if (!RUNS_A_WHOLE_CHECK.test(command.trim())) return [];
  if (CHANGED_SINCE.test(command)) return workspacesGated();

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
