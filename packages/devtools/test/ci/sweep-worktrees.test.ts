import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { gitIn, writeUnder } from "@better-answers/devtools/throwaway-tree";
import {
  commitIn,
  hookScript,
  mergeOnOrigin,
  originAndClone,
  recordsItsArgv,
  runHook,
  scratchRoot,
  stubsOnPath,
  worktreeUnder,
  type HookRun,
} from "@better-answers/devtools/worktree-hooks";

const sweep = hookScript("sweep-worktrees");

const scratch = scratchRoot("sweep-worktrees");

const LONG_AGO = "2026-01-01T00:00:00Z";

const NAMES = [
  "merged",
  "fresh",
  "recent",
  "untracked",
  "unmerged",
  "squashed",
  "locked",
  "elsewhere",
] as const;

type Name = (typeof NAMES)[number];

type Estate = {
  readonly primary: string;
  readonly worktrees: Readonly<Record<Name, string>>;
  readonly log: string;
  readonly run: HookRun;
};

/** jCodeMunch names each worktree `local/<name>`; gh says `t-squashed`'s head merged by squash. */
const stubTools = (
  worktrees: Readonly<Record<Name, string>>,
  squashedHead: string,
  log: string,
): string => {
  const registry = JSON.stringify(
    NAMES.map((name) => ({ repo_id: `local/${name}`, source_root: realpathSync(worktrees[name]) })),
  );
  const merged = JSON.stringify([{ headRefOid: squashedHead, mergedAt: LONG_AGO }]);
  return stubsOnPath(path.join(scratch, "bin"), {
    "jcodemunch-mcp": recordsItsArgv(log, [`[ "$1" = list-repos ] && printf '%s' '${registry}'`]),
    "jdocmunch-mcp": recordsItsArgv(`${log}-doc`, []),
    gh: `case "$*" in *"--head t-squashed"*) printf '%s' '${merged}' ;; *) printf '[]' ;; esac\n`,
  });
};

/** One worktree per case, under the main checkout's `.claude/worktrees/` but for `elsewhere`. */
const arrangeAndSweep = (): Estate => {
  const { origin, primary } = originAndClone(scratch, "estate", { "README.md": "# estate\n" });
  const under = path.join(primary, ".claude/worktrees");
  const at = (name: Name): string => worktreeUnder(under, primary, name);
  const worktrees: Record<Name, string> = {
    merged: at("merged"),
    fresh: at("fresh"),
    recent: at("recent"),
    untracked: at("untracked"),
    unmerged: at("unmerged"),
    squashed: at("squashed"),
    locked: at("locked"),
    elsewhere: worktreeUnder(scratch, primary, "elsewhere"),
  };

  for (const name of ["merged", "untracked", "locked", "elsewhere"] as const) {
    commitIn(worktrees[name], `${name}.txt`);
    mergeOnOrigin(origin, primary, `t-${name}`, LONG_AGO);
  }
  commitIn(worktrees.recent, "recent.txt");
  mergeOnOrigin(origin, primary, "t-recent");
  commitIn(worktrees.unmerged, "unmerged.txt");
  const squashedHead = commitIn(worktrees.squashed, "squashed.txt");
  writeUnder(worktrees.untracked, "half-done.txt", "work in progress\n");
  gitIn(primary, "worktree", "lock", worktrees.locked);

  const log = path.join(scratch, "jcodemunch-argv");
  const bin = stubTools(worktrees, squashedHead, log);
  const run = runHook(sweep, {
    argv: [primary],
    env: { PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
  });
  return { primary, worktrees, log, run };
};

const branchListed = (primary: string, branch: string): boolean =>
  gitIn(primary, "branch", "--list", branch).trim() !== "";

describe("the sweep over worktrees left beside running agents", () => {
  let estate: Estate;
  beforeAll(() => {
    estate = arrangeAndSweep();
  });

  it("exits 0 over an estate it partly keeps", () => {
    expect(estate.run.status).toBe(0);
  });

  it("removes a clean worktree merged over an hour ago", () => {
    expect(existsSync(estate.worktrees.merged)).toBe(false);
  });

  it("deletes the branch of a merged worktree it removed", () => {
    expect(branchListed(estate.primary, "t-merged")).toBe(false);
  });

  it("removes a worktree whose exact head a pull request merged", () => {
    expect(existsSync(estate.worktrees.squashed)).toBe(false);
  });

  it("leaves a squash-merged branch for git branch -d to refuse", () => {
    expect(branchListed(estate.primary, "t-squashed")).toBe(true);
  });

  it("drops the jCodeMunch index of each removed worktree, no other", () => {
    const dropped = readFileSync(estate.log, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("delete-index"));
    expect(dropped).toEqual(["delete-index local/merged", "delete-index local/squashed"]);
  });

  it.each([
    ["a fresh worktree, holding no commit of its own", "fresh"],
    ["a worktree merged under an hour ago", "recent"],
    ["a merged worktree holding untracked files", "untracked"],
    ["a worktree whose commits nothing merged", "unmerged"],
    ["a locked worktree", "locked"],
    ["a merged worktree outside .claude/worktrees", "elsewhere"],
  ] as const)("keeps %s", (_, name) => {
    expect(existsSync(estate.worktrees[name])).toBe(true);
  });
});
