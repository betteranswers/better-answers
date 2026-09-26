import { existsSync, mkdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** macOS starts it without queueing at `syspolicyd`; `/usr/bin/git` is an `xcrun` shim, which starts more. */
export const APPLE_GIT = "/Library/Developer/CommandLineTools/usr/bin/git";

interface Machine {
  readonly platform: NodeJS.Platform;
  readonly searchPath: string;
  readonly appleGit: string;
  readonly linkDirectory: string;
}

const thisMachine = (): Machine => ({
  platform: process.platform,
  searchPath: process.env["PATH"] ?? "",
  appleGit: APPLE_GIT,
  linkDirectory: path.join(tmpdir(), "better-answers-apple-git"),
});

const linksTo = (link: string, target: string): boolean => {
  try {
    return readlinkSync(link) === target;
  } catch {
    // Absent, or not a link: either way it is made again below.
    return false;
  }
};

/** Staged under a name of this process's own and renamed over, so two suites starting at once each leave a whole link. */
const linkGit = (linkDirectory: string, target: string): void => {
  const git = path.join(linkDirectory, "git");
  if (linksTo(git, target)) return;
  mkdirSync(linkDirectory, { recursive: true });
  const staged = `${git}.${String(process.pid)}`;
  rmSync(staged, { force: true });
  symlinkSync(target, staged);
  renameSync(staged, git);
};

/** Homebrew's `git` queues at `syspolicyd` on every start, which a suite of many commits pays in minutes. */
export const pathWithAppleGit = (machine: Machine = thisMachine()): string => {
  if (machine.platform !== "darwin" || !existsSync(machine.appleGit)) return machine.searchPath;
  linkGit(machine.linkDirectory, machine.appleGit);
  const rest = machine.searchPath
    .split(path.delimiter)
    .filter((entry) => entry !== "" && entry !== machine.linkDirectory);
  return [machine.linkDirectory, ...rest].join(path.delimiter);
};
