import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { gitIn, writeUnder } from "@better-answers/devtools/throwaway-tree";
import {
  commitIn,
  hookScript,
  originAndClone,
  repositoryHolding,
  runHook,
  scratchRoot,
  worktreeUnder,
} from "@better-answers/devtools/worktree-hooks";

const hook = hookScript("worktree-create-hook");

const scratch = scratchRoot("worktree-create-hook");

const SWEEP_SECONDS = 10;

describe("creating a worktree", () => {
  it("prints the new directory alone, then sweeps without waiting", async () => {
    const root = repositoryHolding(path.join(scratch, "root"), { "README.md": "# root\n" });
    const swept = path.join(scratch, "swept");
    writeUnder(root, ".claude/hooks/provision-worktree.sh", "exit 0\n");
    writeUnder(
      root,
      ".claude/hooks/sweep-worktrees.sh",
      `printf '%s\\n' "$*" > '${swept}'\nsleep ${String(SWEEP_SECONDS)}\n`,
    );

    const startedMs = Date.now();
    const run = runHook(hook, {
      input: JSON.stringify({ name: "fresh" }),
      env: { CLAUDE_PROJECT_DIR: root },
    });
    const tookMs = Date.now() - startedMs;

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`${root}/.claude/worktrees/fresh\n`);
    expect(
      tookMs,
      "the sweep sleeps longer than a creation may take, so a hook that waited on it shows here",
    ).toBeLessThan((SWEEP_SECONDS * 1000) / 2);
    await vi.waitFor(() => {
      expect(existsSync(swept) && readFileSync(swept, "utf8")).toBe(`${root}\n`);
    });
  });
});

describe("the base a new worktree starts from", () => {
  const QUIET_HOOKS = {
    ".claude/hooks/provision-worktree.sh": "exit 0\n",
    ".claude/hooks/sweep-worktrees.sh": "exit 0\n",
  };

  const createdFrom = (primary: string, cwd: string, name: string): string => {
    const run = runHook(hook, {
      input: JSON.stringify({ name, cwd }),
      env: { CLAUDE_PROJECT_DIR: primary },
    });
    expect(run).toMatchObject({ status: 0 });
    return gitIn(run.stdout.trim(), "rev-parse", "HEAD").trim();
  };

  it("is origin's main whatever the main checkout has out", () => {
    const { origin, primary } = originAndClone(scratch, "feature-out", QUIET_HOOKS);
    const mainTip = commitIn(origin, "merged-since-the-clone.md");
    gitIn(primary, "switch", "-q", "-c", "someone-elses-feature");
    commitIn(primary, "unmerged.md");

    expect(createdFrom(primary, primary, "independent")).toBe(mainTip);
  });

  it("is the local main when origin cannot be reached", () => {
    const { primary } = originAndClone(scratch, "offline", QUIET_HOOKS);
    const localMain = gitIn(primary, "rev-parse", "main").trim();
    gitIn(primary, "remote", "set-url", "origin", path.join(scratch, "nowhere"));
    gitIn(primary, "switch", "-q", "-c", "someone-elses-feature");
    commitIn(primary, "unmerged.md");

    expect(createdFrom(primary, primary, "offline")).toBe(localMain);
  });

  it("is the session's branch for a delegate in a worktree", () => {
    const { origin, primary } = originAndClone(scratch, "delegate", QUIET_HOOKS);
    commitIn(origin, "merged-since-the-clone.md");
    const session = worktreeUnder(scratch, primary, "session");
    const sessionTip = commitIn(session, "the-session-unit.md");

    expect(createdFrom(primary, session, "delegate")).toBe(sessionTip);
  });
});
