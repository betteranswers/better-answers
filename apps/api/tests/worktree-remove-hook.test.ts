import { existsSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeUnder } from "@better-answers/devtools/throwaway-tree";
import {
  hookScript,
  recordsItsArgv,
  repositoryHolding,
  runHook,
  scratchRoot,
  stubsOnPath,
  worktreeUnder,
  type HookRun,
} from "./worktree-hooks.ts";

/**
 * The removal half of the worktree hooks, run for real over a throwaway repository and a
 * worktree of it (T-181).
 *
 * `.claude/hooks/worktree-remove-hook.sh` reads the worktree's path off stdin as JSON,
 * removes a worktree holding no work, keeps one that holds some, and exits zero either way.
 * What is proved here is the other end of provisioning's jCodeMunch stage: the index that
 * stage gave the worktree is dropped when the worktree goes, so no indexed root outlives
 * the path it was cut for. The rule these two cases answer to is this repository's own —
 * a hook command lands with a functional test over a throwaway tree that asserts both
 * where it fires and where it stays silent.
 *
 * `jcodemunch-mcp` is stubbed ahead of the machine's own on PATH, and it is the stub that
 * answers `list-repos --json`: the repository id is not derivable from a path, so the hook
 * has to read it from that registry, and no test here may reach the owner's real one.
 */

const hook = hookScript("worktree-remove-hook");

/** What the stub registry calls the worktree's index — an id no real registry would hold. */
const REPO_ID = "local/throwaway-0f0f0f0f";

const scratch = scratchRoot("worktree-remove-hook");

/**
 * A repository with one commit on `main`, and a worktree of it on a branch of its own.
 *
 * The `.gitignore` carries `.scratch` without a trailing slash, which is what this
 * repository's own carries and why: a worktree's `.scratch` is a symlink, and git reads a
 * symlink as a file, so `.scratch/` would leave it untracked. That pattern's own case is in
 * `provision-worktree.test.ts`, against the root `.gitignore`; here it is the precondition
 * the last case below stands on.
 */
const worktreeOf = (name: string): { readonly root: string; readonly worktree: string } => {
  const root = repositoryHolding(path.join(scratch, `${name}-root`), {
    "README.md": "# throwaway\n",
    ".gitignore": ".scratch\n",
  });
  return { root, worktree: worktreeUnder(scratch, root, name) };
};

/**
 * A `jcodemunch-mcp` that names `worktree` as the source root of {@link REPO_ID} when it is
 * asked for the registry, and appends every command line it is given to `log`.
 */
const stubJcodemunch = (name: string, worktree: string, log: string): string => {
  const registry = JSON.stringify([{ repo_id: REPO_ID, source_root: realpathSync(worktree) }]);
  return stubsOnPath(path.join(scratch, `${name}-bin`), {
    "jcodemunch-mcp": recordsItsArgv(log, [`[ "$1" = list-repos ] && printf '%s' '${registry}'`]),
  });
};

/** The hook, given `worktree` the way Claude Code gives it: one JSON object on stdin. */
const removeHook = (worktree: string, bin: string): HookRun =>
  runHook(hook, {
    input: JSON.stringify({ worktree_path: worktree }),
    env: { PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
  });

/** The command lines the stub was given, in order. */
const argvLines = (log: string): readonly string[] =>
  existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

describe("the jCodeMunch index a removed worktree leaves behind (T-181)", () => {
  it("drops the index of the worktree it removes, so no indexed root outlives its path", () => {
    const { worktree } = worktreeOf("removed");
    const log = path.join(scratch, "removed-argv");
    const bin = stubJcodemunch("removed", worktree, log);

    const run = removeHook(worktree, bin);

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(argvLines(log)).toEqual(["list-repos --json", `delete-index ${REPO_ID}`]);
    expect(run.stderr).toContain(`jcodemunch: dropped the index ${REPO_ID}`);
  });

  it("keeps the index of a worktree holding work, which it keeps on disk too", () => {
    const { worktree } = worktreeOf("kept");
    writeFileSync(path.join(worktree, "half-done.txt"), "work in progress\n");
    const log = path.join(scratch, "kept-argv");
    const bin = stubJcodemunch("kept", worktree, log);

    const run = removeHook(worktree, bin);

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(true);
    expect(argvLines(log)).toEqual([]);
    expect(run.stderr).toContain("keeping");
  });

  it("removes a worktree whose only extra is the .scratch link, and the notes it points at stay", () => {
    const { root, worktree } = worktreeOf("scratch-link");
    writeUnder(root, ".scratch/v01-spec/map.md", "# the map\n");
    symlinkSync(path.join(root, ".scratch"), path.join(worktree, ".scratch"));
    const log = path.join(scratch, "scratch-link-argv");
    const bin = stubJcodemunch("scratch-link", worktree, log);

    const run = removeHook(worktree, bin);

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(readFileSync(path.join(root, ".scratch/v01-spec/map.md"), "utf8")).toBe("# the map\n");
  });
});
