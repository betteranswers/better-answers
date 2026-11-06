import { execFileSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { gitDirOf } from "./journal.ts";

const GIT_OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024;

const STORE = ".pnpm";

const git = (root: string, args: readonly string[], input?: string): string =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
    input: input ?? "",
  });

const filesOnDisk = (root: string): readonly string[] => [
  ...new Set(
    git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
      .split("\0")
      .filter((file) => file !== "" && existsSync(path.join(root, file))),
  ),
];

const foldersOf = (files: readonly string[]): readonly string[] => {
  const folders = new Set<string>(["."]);
  for (const file of files) {
    for (let at = path.posix.dirname(file); at !== "." && !folders.has(at);) {
      folders.add(at);
      at = path.posix.dirname(at);
    }
  }
  return [...folders];
};

const copyFile = (from: string, to: string): void => {
  mkdirSync(path.dirname(to), { recursive: true });
  if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else copyFileSync(from, to, constants.COPYFILE_FICLONE);
};

/** Copied relative links in a node_modules reach the copied sibling workspaces. */
const copyModules = (from: string, to: string): void => {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.name === STORE) symlinkSync(source, target);
    else if (entry.isDirectory()) copyModules(source, target);
    else copyFile(source, target);
  }
};

export const copyTree = (root: string, into: string): void => {
  const files = filesOnDisk(root);
  for (const file of files) copyFile(path.join(root, file), path.join(into, file));
  for (const folder of foldersOf(files)) {
    for (const installed of ["node_modules", ".venv"]) {
      const source = path.join(root, folder, installed);
      const target = path.join(into, folder, installed);
      // A folder that git does not ignore came over with the files.
      if (!existsSync(source) || existsSync(target)) continue;
      if (installed === ".venv") symlinkSync(source, target);
      else copyModules(source, target);
    }
  }
  execFileSync("git", ["init", "--quiet", "--template=", into], { stdio: "pipe" });
  const objects = path.resolve(
    root,
    git(root, ["rev-parse", "--git-common-dir"]).trim(),
    "objects",
  );
  writeFileSync(path.join(into, ".git/objects/info/alternates"), `${objects}\n`);
  git(into, ["update-index", "-z", "--index-info"], git(root, ["ls-files", "-z", "--stage"]));
  git(into, ["update-ref", "HEAD", git(root, ["rev-parse", "HEAD"]).trim()]);
};

/** The temp folder is shared, so a scratch path that is a link or another user's folder is refused. */
const ownedFolder = (folder: string): string => {
  const found = lstatSync(folder);
  if (!found.isDirectory() || found.uid !== process.getuid?.()) {
    throw new Error(`refusing the scratch folder ${folder}: it is not a folder this user owns`);
  }
  return folder;
};

const SCRATCH_PREFIX = "move-files-";

const isScratchPath = (folder: string): boolean =>
  path.dirname(folder) === realpathSync(tmpdir()) &&
  path.basename(folder).startsWith(SCRATCH_PREFIX);

const pointerOf = (root: string): string => path.join(gitDirOf(root), "move-files-scratch");

const claim = z.object({ pid: z.number(), folder: z.string() });

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const claimOf = (pointer: string): z.infer<typeof claim> | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(pointer, "utf8"));
    return claim.parse(parsed);
  } catch {
    return undefined;
  }
};

/** A live run refuses a second one. A dead run's folder is removed only if it is ours. */
export const openScratch = (root: string): string => {
  const pointer = pointerOf(root);
  if (existsSync(pointer)) {
    const held = claimOf(pointer);
    if (held !== undefined && isRunning(held.pid)) {
      throw new Error(
        `another move-files run (pid ${String(held.pid)}) is moving files in this tree`,
      );
    }
    if (held !== undefined && isScratchPath(held.folder)) {
      if (lstatSync(held.folder, { throwIfNoEntry: false }) !== undefined) {
        rmSync(ownedFolder(held.folder), { recursive: true });
      }
    }
    rmSync(pointer);
  }
  const folder = ownedFolder(mkdtempSync(path.join(realpathSync(tmpdir()), SCRATCH_PREFIX)));
  writeFileSync(pointer, JSON.stringify({ pid: process.pid, folder }), { flag: "wx" });
  return folder;
};

export const closeScratch = (root: string, folder: string): void => {
  rmSync(folder, { recursive: true, force: true });
  rmSync(pointerOf(root), { force: true });
};
