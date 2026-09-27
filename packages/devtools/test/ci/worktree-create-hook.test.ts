import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { writeUnder } from "@better-answers/devtools/throwaway-tree";
import {
  hookScript,
  repositoryHolding,
  runHook,
  scratchRoot,
} from "@better-answers/devtools/worktree-hooks";

const hook = hookScript("worktree-create-hook");

const scratch = scratchRoot("worktree-create-hook");

/** Longer than a creation may take, so a hook that waited on the sweep shows in its time. */
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
    expect(tookMs).toBeLessThan((SWEEP_SECONDS * 1000) / 2);
    await vi.waitFor(() => {
      expect(existsSync(swept) && readFileSync(swept, "utf8")).toBe(`${root}\n`);
    });
  });
});
