import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

import { gitIn, throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

export const hookScript = (name: string): string =>
  path.resolve(import.meta.dirname, `../../../.claude/hooks/${name}.sh`);

/** A temporary directory, removed by the `afterAll` this call registers. */
export const scratchRoot = (prefix: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

/** Makes `root` a new repository whose one commit holds `files`. */
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

/** A worktree of `root` at `<scratch>/<name>-worktree`, on a new branch `t-<name>`. */
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

/** Creates `directory` holding an executable bash stub per tool; the caller puts it on PATH. */
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

/** A stub's body: it appends its arguments to `log` as one line, runs `andThen`, then exits 0. */
export const recordsItsArgv = (log: string, andThen: readonly string[] = []): string =>
  [`printf '%s\\n' "$*" >> '${log}'`, ...andThen, "exit 0", ""].join("\n");

export type HookRun = { readonly status: number | null; readonly stderr: string };

/** Runs `script` under bash, with `env` laid over this process's environment. */
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
