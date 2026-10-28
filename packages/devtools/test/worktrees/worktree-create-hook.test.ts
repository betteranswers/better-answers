import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { gitIn } from "@better-answers/devtools/throwaway-tree";
import {
  commitIn,
  hookScript,
  originAndClone,
  recordsItsArgv,
  repositoryHolding,
  runHook,
  scratchRoot,
  stubsOnPath,
  worktreeUnder,
  type HookRun,
} from "@better-answers/devtools/worktree-hooks";

const hook = hookScript("worktree-create-hook");

const scratch = scratchRoot("worktree-create-hook");

const INDEXERS = ["jcodemunch-mcp", "jdocmunch-mcp"] as const;

const QUIET = { "jcodemunch-mcp": "exit 0\n", "jdocmunch-mcp": "exit 0\n", python3: "exit 0\n" };

const pathWithoutIndexers = (bin: string): string =>
  [
    bin,
    ...(process.env["PATH"] ?? "")
      .split(path.delimiter)
      .filter(
        (directory) =>
          directory !== "" && !INDEXERS.some((tool) => existsSync(path.join(directory, tool))),
      ),
  ].join(path.delimiter);

let sandboxes = 0;

const runCreate = (
  primary: string,
  input: { readonly name: string; readonly cwd?: string },
  stubs: Readonly<Record<string, string>> = QUIET,
): HookRun => {
  sandboxes += 1;
  const bin = stubsOnPath(path.join(scratch, `bin-${String(sandboxes)}`), stubs);
  const home = path.join(scratch, `home-${String(sandboxes)}`);
  mkdirSync(home);
  return runHook(hook, {
    input: JSON.stringify(input),
    env: { CLAUDE_PROJECT_DIR: primary, HOME: home, PATH: pathWithoutIndexers(bin) },
  });
};

const upstreamOf = (worktree: string): string | undefined => {
  const result = spawnSync(
    "git",
    ["-C", worktree, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : undefined;
};

const FILES = { "README.md": "# root\n" };

describe("creating a worktree", () => {
  it("prints the new directory alone, whatever the indexers print", () => {
    const root = repositoryHolding(path.join(scratch, "root"), FILES);
    const noisy = recordsItsArgv(path.join(scratch, "noise-argv"), ["echo noise on stdout"]);

    const run = runCreate(root, { name: "fresh" }, { ...QUIET, "jcodemunch-mcp": noisy });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`${root}/.claude/worktrees/fresh\n`);
  });

  it("starts the branch tracking nothing", () => {
    const { primary } = originAndClone(scratch, "tracking", FILES);

    const run = runCreate(primary, { name: "untracked", cwd: primary });

    expect(run.status).toBe(0);
    expect(upstreamOf(run.stdout.trim())).toBeUndefined();
  });
});

describe("the base a new worktree starts from", () => {
  const createdFrom = (primary: string, cwd: string, name: string): string => {
    const run = runCreate(primary, { name, cwd });
    expect(run).toMatchObject({ status: 0 });
    return gitIn(run.stdout.trim(), "rev-parse", "HEAD").trim();
  };

  it("is origin's main whatever the main checkout has out", () => {
    const { origin, primary } = originAndClone(scratch, "feature-out", FILES);
    const mainTip = commitIn(origin, "merged-since-the-clone.md");
    gitIn(primary, "switch", "-q", "-c", "someone-elses-feature");
    commitIn(primary, "unmerged.md");

    expect(createdFrom(primary, primary, "independent")).toBe(mainTip);
  });

  it("is the local main when origin cannot be reached", () => {
    const { primary } = originAndClone(scratch, "offline", FILES);
    const localMain = gitIn(primary, "rev-parse", "main").trim();
    gitIn(primary, "remote", "set-url", "origin", path.join(scratch, "nowhere"));
    gitIn(primary, "switch", "-q", "-c", "someone-elses-feature");
    commitIn(primary, "unmerged.md");

    expect(createdFrom(primary, primary, "offline")).toBe(localMain);
  });

  it("is the session's branch for a delegate in a worktree", () => {
    const { origin, primary } = originAndClone(scratch, "delegate", FILES);
    commitIn(origin, "merged-since-the-clone.md");
    const session = worktreeUnder(scratch, primary, "session");
    const sessionTip = commitIn(session, "the-session-unit.md");

    expect(createdFrom(primary, session, "delegate")).toBe(sessionTip);
  });
});

describe("the indexes a new worktree gets", () => {
  it("gives the worktree an index in both servers", () => {
    const { primary } = originAndClone(scratch, "indexed", FILES);
    const codeLog = path.join(scratch, "code-argv");
    const docLog = path.join(scratch, "doc-argv");

    const run = runCreate(
      primary,
      { name: "indexed", cwd: primary },
      { ...QUIET, "jcodemunch-mcp": recordsItsArgv(codeLog), python3: recordsItsArgv(docLog) },
    );

    const created = realpathSync(run.stdout.trim());
    expect(run.status).toBe(0);
    expect(readFileSync(codeLog, "utf8")).toBe(`index ${created}\n`);
    expect(readFileSync(docLog, "utf8")).toBe(`- ${created}\n`);
  });

  it("creates the worktree without the servers, saying what it costs", () => {
    const { primary } = originAndClone(scratch, "no-indexers", FILES);

    const run = runCreate(primary, { name: "bare", cwd: primary }, {});

    expect(run.status).toBe(0);
    expect(existsSync(run.stdout.trim())).toBe(true);
    expect(run.stderr).toContain("jcodemunch not on PATH — edits here register in the main");
    expect(run.stderr).toContain("jdocmunch not on PATH — doc edits here land in the main");
  });

  it("leaves the worktree usable when an index fails", () => {
    const { primary } = originAndClone(scratch, "failed-index", FILES);

    const run = runCreate(
      primary,
      { name: "failed", cwd: primary },
      { ...QUIET, "jcodemunch-mcp": "exit 3\n", python3: "exit 4\n" },
    );

    expect(run.status).toBe(0);
    expect(existsSync(run.stdout.trim())).toBe(true);
    expect(run.stderr).toContain("jcodemunch index FAILED");
    expect(run.stderr).toContain("jdocmunch index FAILED");
  });
});
