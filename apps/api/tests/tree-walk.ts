import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const NOT_TEXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|sqlite)$/i;
const OUTSIDE = [".scratch/", ".cubic/"];

/**
 * Reading a tracked symlink would follow it to a directory and throw; whatever it points at is
 * walked on its own account.
 */
const isLinkUnder = (root: string, file: string): boolean =>
  lstatSync(path.join(root, file)).isSymbolicLink();

/**
 * The files a commit would carry, untracked ones included, less non-text files, symlinks,
 * `.scratch/` and `.cubic/`.
 */
export const treeFilesUnder = (root: string): readonly string[] =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => !OUTSIDE.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !NOT_TEXT.test(file))
    .filter((file) => !isLinkUnder(root, file));

export const treeFiles = (): readonly string[] => treeFilesUnder(repositoryRoot);

export const readUnder = (root: string, file: string): string =>
  readFileSync(path.join(root, file), "utf8");
