import { existsSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { gitIn, writeUnder } from "@better-answers/devtools/throwaway-tree";
import {
  commitIn,
  hookScript,
  mergeOnOrigin,
  originAndClone,
  recordsItsArgv,
  repositoryHolding,
  runHook,
  scratchRoot,
  stubsOnPath,
  worktreeUnder,
  type HookRun,
} from "@better-answers/devtools/worktree-hooks";

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

/** jCodeMunch names `worktree` as `REPO_ID`, and gh answers `pullRequests` to every `pr list`. */
const stubTools = (name: string, worktree: string, log: string, pullRequests = "[]"): string => {
  const registry = JSON.stringify([{ repo_id: REPO_ID, source_root: realpathSync(worktree) }]);
  return stubsOnPath(path.join(scratch, `${name}-bin`), {
    "jcodemunch-mcp": recordsItsArgv(log, [`[ "$1" = list-repos ] && printf '%s' '${registry}'`]),
    gh: `printf '%s' '${pullRequests}'\n`,
  });
};

const removeHook = (worktree: string, bin: string): HookRun =>
  runHook(hook, {
    input: JSON.stringify({ worktree_path: worktree }),
    env: { PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
  });

const argvLines = (log: string): readonly string[] =>
  existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

const branchListed = (primary: string, branch: string): boolean =>
  gitIn(primary, "branch", "--list", branch).trim() !== "";

describe("the jCodeMunch index a removed worktree leaves behind", () => {
  it("drops the removed worktree's index, leaving no orphaned root", () => {
    const { worktree } = worktreeOf("removed");
    const log = path.join(scratch, "removed-argv");
    const bin = stubTools("removed", worktree, log);

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
    const bin = stubTools("kept", worktree, log);

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
    const bin = stubTools("scratch-link", worktree, log);

    const run = removeHook(worktree, bin);

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(readFileSync(path.join(root, ".scratch/v01-spec/map.md"), "utf8")).toBe("# the map\n");
  });
});

describe("judging a worktree merged, while the main checkout's main lags", () => {
  it("removes it and its branch once origin/main holds its commits", () => {
    const { origin, primary } = originAndClone(scratch, "landed", { "README.md": "# landed\n" });
    const worktree = worktreeUnder(scratch, primary, "landed");
    commitIn(worktree, "work.txt");
    mergeOnOrigin(origin, primary, "t-landed");

    const run = removeHook(
      worktree,
      stubTools("landed", worktree, path.join(scratch, "landed-argv")),
    );

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(branchListed(primary, "t-landed")).toBe(false);
  });

  it("keeps it while nothing merged holds its commits", () => {
    const { primary } = originAndClone(scratch, "unmerged", { "README.md": "# unmerged\n" });
    const worktree = worktreeUnder(scratch, primary, "unmerged");
    commitIn(worktree, "work.txt");

    const run = removeHook(
      worktree,
      stubTools("unmerged", worktree, path.join(scratch, "unmerged-argv")),
    );

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(true);
    expect(run.stderr).toContain("keeping");
  });

  it("removes it once a pull request merged its exact head", () => {
    const { primary } = originAndClone(scratch, "squashed", { "README.md": "# squashed\n" });
    const worktree = worktreeUnder(scratch, primary, "squashed");
    const head = commitIn(worktree, "work.txt");
    const merged = JSON.stringify([{ headRefOid: head, mergedAt: "2026-01-01T00:00:00Z" }]);

    const bin = stubTools("squashed", worktree, path.join(scratch, "squashed-argv"), merged);
    const run = removeHook(worktree, bin);

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(branchListed(primary, "t-squashed")).toBe(true);
  });
});
