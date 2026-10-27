import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { APPLE_GIT, pathWithAppleGit } from "./apple-git.ts";

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const aMachine = (): { readonly appleGit: string; readonly linkDirectory: string } => {
  const root = mkdtempSync(path.join(tmpdir(), "apple-git-"));
  scratch.push(root);
  const appleGit = path.join(root, "clt", "git");
  mkdirSync(path.dirname(appleGit));
  writeFileSync(appleGit, "#!/bin/sh\n");
  chmodSync(appleGit, 0o755);
  return { appleGit, linkDirectory: path.join(root, "first") };
};

const PATH = ["/opt/homebrew/bin", "/usr/bin", "/bin"].join(path.delimiter);

const onAppleGit = process.platform === "darwin" && existsSync(APPLE_GIT);

describe("the test workers' PATH", () => {
  it("is PATH as it is off darwin", () => {
    const machine = aMachine();

    expect(pathWithAppleGit({ ...machine, platform: "linux", searchPath: PATH })).toBe(PATH);
    expect(existsSync(machine.linkDirectory)).toBe(false);
  });

  it("is PATH as it is when Apple's git is absent", () => {
    const machine = aMachine();
    rmSync(machine.appleGit);

    expect(pathWithAppleGit({ ...machine, platform: "darwin", searchPath: PATH })).toBe(PATH);
    expect(existsSync(machine.linkDirectory)).toBe(false);
  });

  it("starts with a directory whose one entry links Apple's git", () => {
    const machine = aMachine();

    const first = pathWithAppleGit({ ...machine, platform: "darwin", searchPath: PATH });

    expect(first).toBe([machine.linkDirectory, PATH].join(path.delimiter));
    expect(readdirSync(machine.linkDirectory)).toEqual(["git"]);
    expect(readlinkSync(path.join(machine.linkDirectory, "git"))).toBe(machine.appleGit);
  });

  it("names the directory once, however often it is read", () => {
    const machine = aMachine();

    const once = pathWithAppleGit({ ...machine, platform: "darwin", searchPath: PATH });
    const twice = pathWithAppleGit({ ...machine, platform: "darwin", searchPath: once });

    expect(twice).toBe(once);
  });

  it("relinks a git that points anywhere else", () => {
    const machine = aMachine();
    mkdirSync(machine.linkDirectory);
    symlinkSync("/usr/bin/git", path.join(machine.linkDirectory, "git"));

    pathWithAppleGit({ ...machine, platform: "darwin", searchPath: PATH });

    expect(readdirSync(machine.linkDirectory)).toEqual(["git"]);
    expect(readlinkSync(path.join(machine.linkDirectory, "git"))).toBe(machine.appleGit);
  });

  it.runIf(onAppleGit)("gives this worker the Command Line Tools' git", () => {
    const found = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

    expect(readlinkSync(found)).toBe("/Library/Developer/CommandLineTools/usr/bin/git");
    expect(execFileSync("git", ["--version"], { encoding: "utf8" })).toContain("Apple Git");
  });

  it.runIf(onAppleGit)("still finds git filter-repo past Apple's git", () => {
    const run = execFileSync("git", ["filter-repo", "--version"], { encoding: "utf8" });

    expect(run.trim()).not.toBe("");
  });
});
