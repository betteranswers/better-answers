import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

import { repositoryRoot } from "./paths.ts";
import { gitIn, throwawayRepository, writeUnder } from "./throwaway-tree.ts";

export const hookScript = (name: string): string =>
  path.join(repositoryRoot, ".claude", "hooks", `${name}.sh`);

export const scratchRoot = (prefix: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

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

export const originAndClone = (
  scratch: string,
  name: string,
  files: Readonly<Record<string, string>>,
): { readonly origin: string; readonly primary: string } => {
  const origin = repositoryHolding(path.join(scratch, `${name}-origin`), files);
  const primary = path.join(scratch, `${name}-primary`);
  gitIn(scratch, "clone", "-q", origin, primary);
  gitIn(primary, "config", "user.email", "test@example.invalid");
  gitIn(primary, "config", "user.name", "throwaway repository");
  return { origin, primary };
};

export const commitIn = (worktree: string, file: string): string => {
  writeUnder(worktree, file, `${file}\n`);
  gitIn(worktree, "add", "-A");
  gitIn(worktree, "commit", "-q", "-m", `add ${file}`);
  return gitIn(worktree, "rev-parse", "HEAD").trim();
};

export const mergeOnOrigin = (
  origin: string,
  primary: string,
  branch: string,
  at?: string,
): void => {
  gitIn(origin, "fetch", "-q", primary, branch);
  const dated = at === undefined ? {} : { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
  const result = spawnSync(
    "git",
    ["-C", origin, "merge", "-q", "--no-ff", "--no-edit", "FETCH_HEAD"],
    {
      encoding: "utf8",
      env: { ...process.env, ...dated },
    },
  );
  if (result.status !== 0) throw new Error(`git merge of ${branch} failed:\n${result.stderr}`);
};

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

export const recordsItsArgv = (log: string, andThen: readonly string[] = []): string =>
  [`printf '%s\\n' "$*" >> '${log}'`, ...andThen, "exit 0", ""].join("\n");

export type HookRun = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type Decoy = {
  readonly pid: number;
  readonly alive: () => boolean;
  readonly stop: () => void;
};

const IDLE = "setInterval(() => {}, 1000)";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Named by the physical path, as the hooks resolve it; `orphaned` leaves it to pid 1 at once. */
export const decoyWorker = (worktree: string, orphaned: boolean): Decoy => {
  const marker = path.join(realpathSync(worktree), "node_modules/vitest/dist/workers/forks.js");
  if (orphaned) {
    const started = spawnSync(
      "sh",
      ["-c", `node -e '${IDLE}' '${marker}' >/dev/null 2>&1 & echo $!`],
      { encoding: "utf8" },
    );
    const pid = Number(started.stdout.trim());
    return { pid, alive: () => alive(pid), stop: () => process.kill(pid) };
  }
  const child = spawn(process.execPath, ["-e", IDLE, marker], { stdio: "ignore" });
  const pid = child.pid ?? -1;
  return { pid, alive: () => alive(pid), stop: () => child.kill() };
};

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
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
