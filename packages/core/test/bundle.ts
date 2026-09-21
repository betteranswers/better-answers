import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll } from "vitest";

import { openGit, type GitDoor } from "@better-answers/core/store/git";

import { removeBundleRoot } from "./bundle-root.ts";

const run = promisify(execFile);

export const bundlesForSuite = (): (() => GitDoor) => {
  let root: string | undefined;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "better-answers-bundles-"));
  });

  afterAll(async () => {
    if (root !== undefined) await removeBundleRoot(root);
  });

  return () => {
    if (root === undefined) throw new Error("the suite's bundle root was read before it existed");
    const opened = openGit(root);

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

    { env: { ...process.env, ...env } },
  );
  return stdout;
};

export const objectRemovedFrom = async (
  door: GitDoor,
  workspaceId: string,
  revision: string,
): Promise<string> => {
  const id = (await git(door, workspaceId, ["rev-parse", revision])).trim();

  await rm(path.join(door.root, `${workspaceId}.git`, "objects", id.slice(0, 2), id.slice(2)));
  return id;
};

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

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

export type CommitFacts = {
  readonly sha: string;

  readonly subject: string;

  readonly author: string;
  readonly committer: string;

  readonly trailers: Readonly<Record<string, string>>;
  readonly parents: readonly string[];

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

export const fileAtCommit = (
  door: GitDoor,
  workspaceId: string,
  sha: string,
  file: string,
): Promise<string> => git(door, workspaceId, ["show", `${sha}:${file}`]);

export const bundleHistory = async (
  door: GitDoor,
  workspaceId: string,
): Promise<readonly string[]> => {
  const listed = await git(door, workspaceId, ["rev-list", "--reverse", "main"]).catch(() => "");
  return listed.split("\n").filter((sha) => sha !== "");
};

export const staged = async (door: GitDoor, workspaceId: string): Promise<readonly string[]> => {
  const listed = await git(door, workspaceId, ["ls-files"]);
  return listed.split("\n").filter((file) => file !== "");
};

export const removeRepository = (door: GitDoor, workspaceId: string): Promise<void> =>
  rm(path.join(door.root, `${workspaceId}.git`), { recursive: true, force: true });

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

export const objectPresent = async (
  door: GitDoor,
  workspaceId: string,
  sha: string,
): Promise<boolean> =>
  git(door, workspaceId, ["cat-file", "-e", sha])
    .then(() => true)
    .catch(() => false);

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
