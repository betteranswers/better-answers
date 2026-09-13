import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { gitIn, throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

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

const hook = path.resolve(import.meta.dirname, "../../../.claude/hooks/worktree-remove-hook.sh");

/** What the stub registry calls the worktree's index — an id no real registry would hold. */
const REPO_ID = "local/throwaway-0f0f0f0f";

const scratch = mkdtempSync(path.join(tmpdir(), "worktree-remove-hook-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A repository with one commit on `main`, and a worktree of it on a branch of its own. */
const worktreeOf = (name: string): string => {
  const root = throwawayRepository(path.join(scratch, `${name}-root`));
  writeUnder(root, "README.md", "# throwaway\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "tracked");
  const worktree = path.join(scratch, `${name}-worktree`);
  gitIn(root, "worktree", "add", "-q", "-b", `t-${name}`, worktree);
  return worktree;
};

/**
 * A `jcodemunch-mcp` that names `worktree` as the source root of {@link REPO_ID} when it is
 * asked for the registry, and appends every command line it is given to `log`.
 */
const stubJcodemunch = (name: string, worktree: string, log: string): string => {
  const bin = path.join(scratch, `${name}-bin`);
  mkdirSync(bin);
  const registry = JSON.stringify([{ repo_id: REPO_ID, source_root: realpathSync(worktree) }]);
  const file = path.join(bin, "jcodemunch-mcp");
  writeFileSync(
    file,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> '${log}'`,
      `[ "$1" = list-repos ] && printf '%s' '${registry}'`,
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(file, 0o755);
  return bin;
};

type Run = { readonly status: number | null; readonly stderr: string };

/** The hook, given `worktree` the way Claude Code gives it: one JSON object on stdin. */
const removeHook = (worktree: string, bin: string): Run => {
  const result = spawnSync("bash", [hook], {
    encoding: "utf8",
    input: JSON.stringify({ worktree_path: worktree }),
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
  });
  return { status: result.status, stderr: result.stderr };
};

/** The command lines the stub was given, in order. */
const argvLines = (log: string): readonly string[] =>
  existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

describe("the jCodeMunch index a removed worktree leaves behind (T-181)", () => {
  it("drops the index of the worktree it removes, so no indexed root outlives its path", () => {
    const worktree = worktreeOf("removed");
    const log = path.join(scratch, "removed-argv");
    const bin = stubJcodemunch("removed", worktree, log);

    const run = removeHook(worktree, bin);

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(argvLines(log)).toEqual(["list-repos --json", `delete-index ${REPO_ID}`]);
    expect(run.stderr).toContain(`jcodemunch: dropped the index ${REPO_ID}`);
  });

  it("keeps the index of a worktree holding work, which it keeps on disk too", () => {
    const worktree = worktreeOf("kept");
    writeFileSync(path.join(worktree, "half-done.txt"), "work in progress\n");
    const log = path.join(scratch, "kept-argv");
    const bin = stubJcodemunch("kept", worktree, log);

    const run = removeHook(worktree, bin);

    expect(run.status).toBe(0);
    expect(existsSync(worktree)).toBe(true);
    expect(argvLines(log)).toEqual([]);
    expect(run.stderr).toContain("keeping");
  });
});
