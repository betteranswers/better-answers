import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll } from "vitest";

import { openGit, type GitDoor } from "@better-answers/core/store/git";

import { removeBundleRoot } from "./bundle-root.ts";

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
    // Not a bare `rm`: the acts this suite left on the repository's lock are waited for
    // first, because one of them still writing while the removal walks the tree is an
    // `ENOTEMPTY` against a file whose every assertion passed (`bundle-root.ts`, T-172).
    if (root !== undefined) await removeBundleRoot(root);
  });

  return () => {
    // Reached only from a test body, which runs after `beforeAll`; the throw is what a
    // caller gets instead of `undefined` if that ever stops being true.
    if (root === undefined) throw new Error("the suite's bundle root was read before it existed");
    const opened = openGit(root);
    // `mkdtemp` above always hands back an absolute, existing directory, so a refusal here
    // means the door's own check regressed — the throw is what a test sees instead of a
    // `GitDoor` built from a root nobody validated.
    if (!opened.ok) throw new Error(`the suite's bundle root was refused: ${opened.error}`);
    return opened.value;
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

/**
 * Take one object out of the repository's store and leave every reference to it standing: what
 * a half-written or corrupted object looks like to a reader that walks the history to it.
 *
 * It is here rather than in a suite because the failure it arranges is a store's and not an
 * act's, and because it is the only way to see the one exit that matters: `git grep` meets an
 * object it cannot read, writes `error: … unable to read …` to stderr and exits **1** — the
 * same status a needle nobody's file carries exits with — so a door that reads 1 as *nothing
 * matched* tells an erasure that no file names the person by the one store that could not look.
 */
export const objectRemovedFrom = async (
  door: GitDoor,
  workspaceId: string,
  revision: string,
): Promise<string> => {
  const id = (await git(door, workspaceId, ["rev-parse", revision])).trim();
  // Loose, because every object these suites write is written one at a time and nothing packs
  // them; a packed object would have to be removed with its pack and is not what this arranges.
  await rm(path.join(door.root, `${workspaceId}.git`, "objects", id.slice(0, 2), id.slice(2)));
  return id;
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

/**
 * Every object the bundle's history reaches, as one run of bytes: the commits with their
 * author lines and messages, the trees, and every blob at every commit. A claim about what a
 * rewritten repository no longer holds is made against this and never against the head's
 * tree, because the head is the one place a rewrite is easy to get right by accident.
 *
 * `rev-list --objects` names every object reachable from the ref, oldest commit's blobs
 * included, and `cat-file --batch` prints each one's contents in a single pass.
 */
export const everyObjectOf = async (door: GitDoor, workspaceId: string): Promise<string> => {
  const listed = await git(door, workspaceId, ["rev-list", "--objects", "main"]).catch(() => "");
  const objects = listed
    .split("\n")
    .map((line) => line.split(" ")[0] ?? "")
    .filter((sha) => sha !== "");
  if (objects.length === 0) return "";
  const child = run(
    "git",
    ["--git-dir", path.join(door.root, `${workspaceId}.git`), "cat-file", "--batch", "--buffer"],
    { env: { ...process.env }, maxBuffer: 64 * 1024 * 1024 },
  );
  child.child.stdin?.end(`${objects.join("\n")}\n`);
  const { stdout } = await child;
  return stdout;
};

/**
 * Whether the repository still holds an object under this hash — `git cat-file -e`, whose
 * whole answer is its exit status. A pre-rewrite commit that answers `true` is a commit the
 * rewrite left behind for anyone who kept its hash.
 */
export const objectPresent = async (
  door: GitDoor,
  workspaceId: string,
  sha: string,
): Promise<boolean> =>
  git(door, workspaceId, ["cat-file", "-e", sha])
    .then(() => true)
    .catch(() => false);

/** `Name <address>` for every commit on the bundle's ref, oldest first. */
export const authorLinesOf = async (
  door: GitDoor,
  workspaceId: string,
): Promise<readonly string[]> => {
  const logged = await git(door, workspaceId, [
    "log",
    "--reverse",
    "--format=%an <%ae>",
    "main",
  ]).catch(() => "");
  return logged.split("\n").filter((line) => line !== "");
};
