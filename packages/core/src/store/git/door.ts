import {
  execFile,
  type ChildProcess,
  type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  err,
  ok,
  type PlatformPrincipal,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";

export const run = promisify(execFile);

export type GitDoor = {
  readonly root: string;

  readonly commitBudgetMs?: number;
};

export type GitRootRefusal = "root-not-absolute" | "no-such-root";

export const openGit = (root: string): Result<GitDoor, GitRootRefusal> => {
  if (!path.isAbsolute(root)) return err("root-not-absolute");
  try {
    if (!statSync(root).isDirectory()) return err("no-such-root");
  } catch {
    return err("no-such-root");
  }
  return ok({ root });
};

export const BUNDLE_REF = "refs/heads/main";

export const repositoryPath = (door: GitDoor, workspaceId: string): string =>
  path.join(door.root, `${workspaceId}.git`);

export const bundleOf = (door: GitDoor, principal: UserPrincipal): string =>
  repositoryPath(door, principal.workspaceId);

/**
 * `env` replaces rather than extends, so the spread keeps PATH; `LC_ALL=C` keeps git's messages
 * English for the compare-and-swap match below.
 */
export const childEnvironment = (
  added: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv => ({
  ...process.env,
  ...added,
  LC_ALL: "C",
});

const feeding = (child: ChildProcess, input: string | undefined): void => {
  if (input === undefined) return;
  child.stdin?.on("error", (cause: NodeJS.ErrnoException) => {
    if (cause.code !== "EPIPE" && cause.code !== "ERR_STREAM_DESTROYED") child.kill();
  });
  child.stdin?.end(input);
};

const EXIT_GRACE_MS = 5_000;

const exitedWithin = async (child: ChildProcess, graceMs: number): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const outright = setTimeout(() => child.kill("SIGKILL"), graceMs);
  try {
    await exited;
  } finally {
    clearTimeout(outright);
  }
};

export const git = async (
  gitDir: string,
  arguments_: readonly string[],
  options: {
    readonly input?: string;
    readonly env?: Readonly<Record<string, string>>;

    readonly raw?: boolean;

    /** Stops the child with SIGTERM, on which git removes the lock files it holds. */
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<string> => {
  const childOptions: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8",
    env: childEnvironment(options.env),
    maxBuffer: 64 * 1024 * 1024,
  };
  if (options.signal !== undefined) childOptions.signal = options.signal;
  const running = run("git", ["--git-dir", gitDir, ...arguments_], childOptions);
  feeding(running.child, options.input);
  try {
    const { stdout } = await running;
    return options.raw === true ? stdout : stdout.trim();
  } catch (cause) {
    if (options.signal?.aborted === true) await exitedWithin(running.child, EXIT_GRACE_MS);
    throw cause;
  }
};

export const exitStatusOf = (cause: unknown): number | null => {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const { code } = cause;
  return typeof code === "number" ? code : null;
};

export const stderrOf = (cause: unknown): string => {
  if (typeof cause !== "object" || cause === null || !("stderr" in cause)) return "";
  const { stderr } = cause;
  return typeof stderr === "string" ? stderr.trim() : "";
};

const stdoutOf = (cause: unknown): string => {
  if (typeof cause !== "object" || cause === null || !("stdout" in cause)) return "";
  const { stdout } = cause;
  return typeof stdout === "string" ? stdout.trim() : "";
};

export const standingHead = async (
  gitDir: string,
  signal?: AbortSignal,
): Promise<Result<string | null, "no-such-repository">> => {
  try {
    const read = await git(
      gitDir,
      ["rev-parse", "--git-dir", "--verify", "--quiet", `${BUNDLE_REF}^{commit}`],
      { signal },
    );
    return ok(read.split("\n")[1] ?? null);
  } catch (cause) {
    if (signal?.aborted === true) throw cause;
    return stdoutOf(cause) === "" ? err("no-such-repository") : ok(null);
  }
};

export const initRepository = async (door: GitDoor, workspaceId: string): Promise<string> => {
  const gitDir = repositoryPath(door, workspaceId);
  await run("git", ["init", "--bare", "--initial-branch", "main", gitDir]);
  return gitDir;
};

/**
 * The bundle's `main` commit, or null when git cannot read one, as in a missing or empty
 * repository.
 */
export const head = (principal: UserPrincipal, door: GitDoor): Promise<string | null> =>
  headOf(bundleOf(door, principal));

export const headOf = async (gitDir: string): Promise<string | null> => {
  const standing = await standingHead(gitDir);
  return standing.ok ? standing.value : null;
};

const locks = new Map<string, Promise<unknown>>();

export const withRepositoryLock = <T>(
  principal: UserPrincipal,
  door: GitDoor,
  work: () => Promise<T>,
): Promise<T> => lockedRepository(bundleOf(door, principal), work);

export const withRepositoryLockAs = <T>(
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  work: () => Promise<T>,
): Promise<T> => lockedRepository(repositoryPath(door, workspaceId), work);

export const tryRepositoryLockAs = async <T>(
  platform: PlatformPrincipal,
  door: GitDoor,
  workspaceId: string,
  work: () => Promise<T>,
): Promise<Result<T, "held">> => {
  const key = repositoryPath(door, workspaceId);
  if (locks.has(key)) return err("held");
  return ok(await lockedRepository(key, work));
};

const lockedRepository = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const ahead = locks.get(key) ?? Promise.resolve();
  const mine = ahead.then(work, work);

  const chained = mine.catch(() => undefined);
  locks.set(key, chained);
  try {
    return await mine;
  } finally {
    if (locks.get(key) === chained) locks.delete(key);
  }
};
