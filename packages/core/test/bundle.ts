import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll } from "vitest";

import { openGit, type GitDoor } from "@better-answers/core/store/git";

/**
 * One real bare repository per suite, in a temporary directory — the git half of what a
 * governed write's tests need, written once here beside `suite-postgres.ts`, which is the
 * Postgres half.
 *
 * Real, not a fake: the door shells out to the git binary (ADR 0024), so the only way to
 * assert what a commit *is* — its author, its committer, its trailers, its tree — is to ask
 * git about the repository the act actually wrote (`[TEST1]`, `[TEST3]`).
 */

const run = promisify(execFile);

export const bundlesForSuite = (): (() => GitDoor) => {
  let root: string | undefined;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "better-answers-bundles-"));
  });

  afterAll(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  return () => {
    // Reached only from a test body, which runs after `beforeAll`; the throw is what a
    // caller gets instead of `undefined` if that ever stops being true.
    if (root === undefined) throw new Error("the suite's bundle root was read before it existed");
    return openGit(root);
  };
};

const git = async (
  door: GitDoor,
  workspaceId: string,
  arguments_: readonly string[],
  env: Readonly<Record<string, string>> = {},
) => {
  const { stdout } = await run(
    "git",
    ["--git-dir", path.join(door.root, `${workspaceId}.git`), ...arguments_],
    // The parent's environment plus what a caller adds, never a bare object: `env` replaces
    // rather than extends, and the binary still has to be found on a PATH.
    { env: { ...process.env, ...env } },
  );
  return stdout;
};

/** The empty tree, which git holds in every repository without writing an object for it. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Point the bundle's ref at a root commit that shares nothing with its history — the shape
 * of a repository and a database that disagree about the past, which no replay may paper
 * over. Made through the binary rather than the door, because the door refuses exactly this.
 */
export const divergeHistory = async (door: GitDoor, workspaceId: string): Promise<string> => {
  const nobody = {
    GIT_AUTHOR_NAME: "Nobody",
    GIT_AUTHOR_EMAIL: "nobody@acme.invalid",
    GIT_COMMITTER_NAME: "Nobody",
    GIT_COMMITTER_EMAIL: "nobody@acme.invalid",
  };
  const root = (
    await git(door, workspaceId, ["commit-tree", EMPTY_TREE, "-m", "elsewhere"], nobody)
  ).trim();
  await git(door, workspaceId, ["update-ref", "refs/heads/main", root]);
  return root;
};

/** One commit as git itself reports it — every field a governed write's tests assert on. */
export type CommitFacts = {
  readonly sha: string;
  /** The message's first line, before the blank line the trailers sit under. */
  readonly subject: string;
  /** `Name <address>`, the two identity lines a commit carries. */
  readonly author: string;
  readonly committer: string;
  /** The trailers by key, in ADR 0012's names: `Actor`, `Audit`, `Run`, `Suggestion`, `Projection`. */
  readonly trailers: Readonly<Record<string, string>>;
  readonly parents: readonly string[];
  /** Every path in the commit's tree, so a commit that lost a file is visible. */
  readonly files: readonly string[];
};

const FIELD = "%H%n%s%n%an <%ae>%n%cn <%ce>%n%P%n%B";

export const commitFacts = async (
  door: GitDoor,
  workspaceId: string,
  sha: string,
): Promise<CommitFacts> => {
  const shown = await git(door, workspaceId, ["show", "-s", `--format=${FIELD}`, sha]);
  const [id = "", subject = "", author = "", committer = "", parents = "", ...message] =
    shown.split("\n");
  // The trailers are the block **after the message's blank line**, never any line of the
  // message that happens to look like one — which is the whole point of refusing a subject
  // that carries a newline: a reader that matched the first `Key: value` anywhere would take
  // a forged trailer as the real one, and this harness must not be the reader that does.
  const blank = message.indexOf("");
  const trailers: Record<string, string> = {};
  for (const line of blank === -1 ? [] : message.slice(blank + 1)) {
    const match = /^([A-Za-z][A-Za-z-]*): (.+)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) trailers[match[1]] = match[2];
  }
  const tree = await git(door, workspaceId, ["ls-tree", "-r", "--name-only", sha]);
  return {
    sha: id,
    subject,
    author,
    committer,
    trailers,
    parents: parents.split(" ").filter((parent) => parent !== ""),
    files: tree.split("\n").filter((file) => file !== ""),
  };
};

/** A file's bytes at a commit, as the worker would read them over its read-only mount. */
export const fileAtCommit = (
  door: GitDoor,
  workspaceId: string,
  sha: string,
  file: string,
): Promise<string> => git(door, workspaceId, ["show", `${sha}:${file}`]);

/** Every commit on the bundle's ref, oldest first — the history `bundle_commit` is a prefix of. */
export const bundleHistory = async (
  door: GitDoor,
  workspaceId: string,
): Promise<readonly string[]> => {
  // `rev-list` has no way of saying "this branch has no commits yet" but a non-zero exit, and
  // a bundle with no commits is where every bundle starts — the empty list is the answer.
  const listed = await git(door, workspaceId, ["rev-list", "--reverse", "main"]).catch(() => "");
  return listed.split("\n").filter((sha) => sha !== "");
};

/**
 * What the repository's *own* index holds — empty for every bundle the door has written,
 * because a governed write stages in an index of its own and never the repository's.
 */
export const staged = async (door: GitDoor, workspaceId: string): Promise<readonly string[]> => {
  const listed = await git(door, workspaceId, ["ls-files"]);
  return listed.split("\n").filter((file) => file !== "");
};

/** Take a workspace's bundle away, for the tests about a repository that is not there. */
export const removeRepository = (door: GitDoor, workspaceId: string): Promise<void> =>
  rm(path.join(door.root, `${workspaceId}.git`), { recursive: true, force: true });
