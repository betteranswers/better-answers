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

const hook = hookScript("worktree-remove-hook");

const REPO_ID = "local/throwaway-0f0f0f0f";

const scratch = scratchRoot("worktree-remove-hook");

const worktreeOf = (name: string): { readonly root: string; readonly worktree: string } => {
  const root = repositoryHolding(path.join(scratch, `${name}-root`), {
    "README.md": "# throwaway\n",
    ".gitignore": ".scratch\n",
  });
  return { root, worktree: worktreeUnder(scratch, root, name) };
};

const stubJcodemunch = (name: string, worktree: string, log: string): string => {
  const registry = JSON.stringify([{ repo_id: REPO_ID, source_root: realpathSync(worktree) }]);
  return stubsOnPath(path.join(scratch, `${name}-bin`), {
    "jcodemunch-mcp": recordsItsArgv(log, [`[ "$1" = list-repos ] && printf '%s' '${registry}'`]),
  });
};

const removeHook = (worktree: string, bin: string): HookRun =>
  runHook(hook, {
    input: JSON.stringify({ worktree_path: worktree }),
    env: { PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
  });

const argvLines = (log: string): readonly string[] =>
  existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

describe("the jCodeMunch index a removed worktree leaves behind", () => {
  it("drops the removed worktree's index, leaving no orphaned root", () => {
    const { worktree } = worktreeOf("removed");
    const log = path.join(scratch, "removed-argv");
    const bin = stubJcodemunch("removed", worktree, log);

    const run = removeHook(worktree, bin);

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(argvLines(log)).toEqual(["list-repos --json", `delete-index ${REPO_ID}`]);
    expect(run.stderr).toContain(`jcodemunch: dropped the index ${REPO_ID}`);
  });

  it("keeps a worktree holding work, and its index", () => {
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

  it("removes a worktree holding only a .scratch link, notes intact", () => {
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
