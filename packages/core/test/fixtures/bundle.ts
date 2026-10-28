import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll } from "vitest";

import { openGit, type GitDoor } from "@better-answers/core/store/git";

import { removeBundleRoot } from "./bundle-root.ts";

const run = promisify(execFile);

/** Git's one seam inside a commit: a hook that parks a ref update, or refuses it, on a file. */
export const gatingRefUpdates = async (door: GitDoor, workspaceId: string) => {
  const repository = path.join(door.root, `${workspaceId}.git`);
  const gate = path.join(repository, "gate");
  const at = (name: string): string => path.join(gate, name);
  const hooks = path.join(repository, "hooks");
  await mkdir(gate, { recursive: true });
  await mkdir(hooks, { recursive: true });
  await writeFile(
    path.join(hooks, "reference-transaction"),
    [
      "#!/bin/sh",
      "cat >/dev/null",
      '[ "$1" = prepared ] || exit 0',
      `[ -e "${at("refuse")}" ] && exit 1`,
      `[ -e "${at("park")}" ] || exit 0`,
      `touch "${at("parked")}"`,
      "turns=0",
      `while [ -e "${at("park")}" ] && [ "$turns" -lt 1200 ]; do`,
      "  sleep 0.05",
      "  turns=$((turns + 1))",
      "done",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const exists = (name: string): Promise<boolean> =>
    access(at(name)).then(
      () => true,
      () => false,
    );
  return {
    park: () => writeFile(at("park"), ""),
    parked: () => exists("parked"),
    unpark: () => rm(at("park")),
    refuse: () => writeFile(at("refuse"), ""),
    allow: () => rm(at("refuse")),
  };
};

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

const gitDirOf = (door: GitDoor, workspaceId: string): string =>
  path.join(door.root, `${workspaceId}.git`);

const linesOf = (text: string): string[] => text.split("\n").filter((line) => line !== "");

const git = async (
  door: GitDoor,
  workspaceId: string,
  arguments_: readonly string[],
  env: Readonly<Record<string, string>> = {},
) => {
  const { stdout } = await run(
    "git",
    ["--git-dir", gitDirOf(door, workspaceId), ...arguments_],

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

  await rm(path.join(gitDirOf(door, workspaceId), "objects", id.slice(0, 2), id.slice(2)));
  return id;
};

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const NOBODY = {
  GIT_AUTHOR_NAME: "Nobody",
  GIT_AUTHOR_EMAIL: "nobody@acme.invalid",
  GIT_COMMITTER_NAME: "Nobody",
  GIT_COMMITTER_EMAIL: "nobody@acme.invalid",
};

export const emptyRootCommit = async (
  door: GitDoor,
  workspaceId: string,
  message: string,
): Promise<string> => {
  const root = (
    await git(door, workspaceId, ["commit-tree", EMPTY_TREE, "-m", message], NOBODY)
  ).trim();
  await git(door, workspaceId, ["update-ref", "refs/heads/main", root]);
  return root;
};

export const treeCommitted = async (
  door: GitDoor,
  workspaceId: string,
  files: ReadonlyMap<string, string>,
  message: string,
): Promise<string> => {
  const workTree = await mkdtemp(path.join(tmpdir(), "better-answers-tree-"));
  const index = { GIT_INDEX_FILE: `${workTree}.index` };
  try {
    for (const [file, content] of files) {
      await mkdir(path.dirname(path.join(workTree, file)), { recursive: true });
      await writeFile(path.join(workTree, file), content);
    }
    await git(door, workspaceId, ["--work-tree", workTree, "add", "--all"], index);
    const tree = (await git(door, workspaceId, ["write-tree"], index)).trim();
    const parent = (await bundleHistory(door, workspaceId)).at(-1);
    const sha = (
      await git(
        door,
        workspaceId,
        ["commit-tree", tree, ...(parent === undefined ? [] : ["-p", parent]), "-m", message],
        NOBODY,
      )
    ).trim();
    await git(door, workspaceId, ["update-ref", "refs/heads/main", sha]);
    return sha;
  } finally {
    await rm(workTree, { recursive: true, force: true });
    await rm(index.GIT_INDEX_FILE, { force: true });
  }
};

export const divergeHistory = (door: GitDoor, workspaceId: string): Promise<string> =>
  emptyRootCommit(door, workspaceId, "elsewhere");

/**
 * Leaves the lock a writer in another process holds while it moves `main`, so the next ref move
 * here loses. Hands back the release.
 */
export const holdMainRef = async (
  door: GitDoor,
  workspaceId: string,
): Promise<() => Promise<void>> => {
  const lock = path.join(gitDirOf(door, workspaceId), "refs", "heads", "main.lock");
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, "");
  return () => rm(lock);
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

const trailersOf = (message: readonly string[]): Record<string, string> => {
  const blank = message.indexOf("");
  const trailers: Record<string, string> = {};
  for (const line of blank === -1 ? [] : message.slice(blank + 1)) {
    const match = /^([A-Za-z][A-Za-z-]*): (.+)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) trailers[match[1]] = match[2];
  }
  return trailers;
};

export const commitFacts = async (
  door: GitDoor,
  workspaceId: string,
  sha: string,
): Promise<CommitFacts> => {
  const shown = await git(door, workspaceId, ["show", "-s", `--format=${FIELD}`, sha]);
  const [id = "", subject = "", author = "", committer = "", parents = "", ...message] =
    shown.split("\n");

  const tree = await git(door, workspaceId, ["ls-tree", "-r", "--name-only", sha]);
  return {
    sha: id,
    subject,
    author,
    committer,
    trailers: trailersOf(message),
    parents: parents.split(" ").filter((parent) => parent !== ""),
    files: linesOf(tree),
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
  return linesOf(listed);
};

export const staged = async (door: GitDoor, workspaceId: string): Promise<readonly string[]> => {
  const listed = await git(door, workspaceId, ["ls-files"]);
  return linesOf(listed);
};

export const removeRepository = (door: GitDoor, workspaceId: string): Promise<void> =>
  rm(gitDirOf(door, workspaceId), { recursive: true, force: true });

export const corruptPackedRefs = async (door: GitDoor, workspaceId: string): Promise<void> => {
  await git(door, workspaceId, ["pack-refs", "--all"]);
  await writeFile(
    path.join(gitDirOf(door, workspaceId), "packed-refs"),
    "# pack-refs with: peeled fully-peeled sorted \nnot-a-ref-line\n",
  );
};

export const everyObjectOf = async (door: GitDoor, workspaceId: string): Promise<string> => {
  const listed = await git(door, workspaceId, ["rev-list", "--objects", "main"]).catch(() => "");
  const objects = listed
    .split("\n")
    .map((line) => line.split(" ")[0] ?? "")
    .filter((sha) => sha !== "");
  if (objects.length === 0) return "";
  const child = run(
    "git",
    ["--git-dir", gitDirOf(door, workspaceId), "cat-file", "--batch", "--buffer"],
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
  return linesOf(logged);
};
