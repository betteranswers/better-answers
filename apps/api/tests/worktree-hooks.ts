import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

import { gitIn, throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

/**
 * What the two worktree-hook suites both need to run a hook for real: a scratch root that
 * removes itself, the hook by name, a worktree of a throwaway repository, bash stubs ahead
 * of this machine's own tools on PATH, and the run itself read as an exit and a stderr.
 *
 * `provision-worktree.test.ts` and `worktree-remove-hook.test.ts` are the two halves of one
 * subject — a worktree's life from the hook that provisions it to the hook that removes it —
 * and they had grown the same preamble twice. It lives here once instead, which is also what
 * the copy gate asks for. The stubbing in particular is worth getting right in one place:
 * a case that reaches the owner's real `pnpm`, `uv` or `jcodemunch-mcp` is a case that writes
 * into this machine's own state and proves nothing about the hook.
 */

/** A hook of this repository's own, by the name it carries under `.claude/hooks`. */
export const hookScript = (name: string): string =>
  path.resolve(import.meta.dirname, `../../../.claude/hooks/${name}.sh`);

/**
 * A scratch directory for one test file, removed when that file's tests are done.
 *
 * The removal is registered here rather than left to the caller: `afterAll` binds to the
 * file that imported this module, and a suite that builds git repositories under a directory
 * nobody removes leaves one of each per run in the platform's temporary directory.
 */
export const scratchRoot = (prefix: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

/**
 * A throwaway repository at `root` holding `files`, all of them committed on `main`.
 *
 * The commit is the point: `git worktree add` needs a commit to cut a branch from, and a
 * file a hook is meant to read — a `.gitignore` above all — decides nothing from the index.
 */
export const repositoryHolding = (
  root: string,
  files: Readonly<Record<string, string>>,
): string => {
  throwawayRepository(root);
  for (const [file, content] of Object.entries(files)) writeUnder(root, file, content);
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "tracked");
  return root;
};

/**
 * A worktree of `root` at `<name>-worktree` under `scratch`, on a branch `t-<name>`.
 *
 * `startPoint` is the commit the branch is cut from, and naming it is never incidental:
 * `git worktree add -b <branch> <path> origin/main` sets the new branch to track
 * `origin/main`, which is the condition provisioning's upstream stage exists to unset. Left
 * out, the branch is cut from the checked-out commit and tracks nothing.
 */
export const worktreeUnder = (
  scratch: string,
  root: string,
  name: string,
  startPoint?: string,
): string => {
  const worktree = path.join(scratch, `${name}-worktree`);
  const from = startPoint === undefined ? [] : [startPoint];
  gitIn(root, "worktree", "add", "-q", "-b", `t-${name}`, worktree, ...from);
  return worktree;
};

/**
 * Executables written into `directory`, one per `<tool> -> <bash body>` entry, each saying
 * whatever its body says. The caller puts the directory ahead of the real tools on the PATH
 * the hook runs with, so what a case proves is what the hook asked for and not what this
 * machine happens to have installed.
 */
export const stubsOnPath = (
  directory: string,
  bodies: Readonly<Record<string, string>>,
): string => {
  mkdirSync(directory);
  for (const [tool, body] of Object.entries(bodies)) {
    const file = path.join(directory, tool);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}`);
    chmodSync(file, 0o755);
  }
  return directory;
};

/**
 * A stub body that appends the command line it was given to `log` and says yes. `andThen` is
 * for a stub that has to answer as well as record — a registry a hook reads back — and its
 * lines run after the record and before the exit, so a stub that answers still logs.
 */
export const recordsItsArgv = (log: string, andThen: readonly string[] = []): string =>
  [`printf '%s\\n' "$*" >> '${log}'`, ...andThen, "exit 0", ""].join("\n");

/** What a hook run tells its reader: whether it agreed, and what it said on the way. */
export type HookRun = { readonly status: number | null; readonly stderr: string };

/**
 * One hook, run under bash. `argv` is what Claude Code puts on its command line and `input`
 * what Claude Code writes to its stdin — each hook reads one or the other, and a hook given
 * no `input` reads the closed stdin it would have been given anyway. `env` is added to this
 * process's environment rather than replacing it, because a hook spawned with an empty
 * environment loses PATH and the platform's temporary directory and fails for reasons that
 * have nothing to do with what it was asked.
 */
export const runHook = (
  script: string,
  options: {
    readonly argv?: readonly string[];
    readonly input?: string;
    readonly env: Readonly<Record<string, string>>;
  },
): HookRun => {
  const result = spawnSync("bash", [script, ...(options.argv ?? [])], {
    encoding: "utf8",
    input: options.input ?? "",
    env: { ...process.env, ...options.env },
  });
  return { status: result.status, stderr: result.stderr };
};
