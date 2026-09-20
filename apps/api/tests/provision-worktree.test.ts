import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { gitIn, throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

/**
 * The upstream stage of worktree provisioning, run over a throwaway clone and a worktree of
 * it (T-099, `[CHECK1]`).
 *
 * `git worktree add -b <branch> <path> origin/main` sets the new branch to track
 * `origin/main`, silently, so a bare `git push` from the worktree aims at `main`.
 * `.claude/hooks/provision-worktree.sh` unsets it and says so on its own line, and does
 * nothing — saying that too — for a branch that tracks nothing. The other stages are the
 * installs; they are stubbed on PATH here, because what this proves is a fact about a
 * branch's configuration and not about pnpm. The skills stage runs for real over a primary
 * that has skills to give, so the script reaches its last line and its exit is read.
 *
 * The second describe is the jCodeMunch stage (T-181): the worktree is indexed as its own
 * root at provisioning, so the first file an agent edits there is registered in the
 * worktree's index rather than resolved into the primary checkout's. Its three cases are
 * the stage's three outcomes — indexed, no tool on the machine, and an index that failed.
 *
 * The third describe is the scratch stage: the worktree's `.scratch` is a symlink into the
 * primary checkout's, so the relative pointers the ADRs, specs and discovery tickets carry
 * resolve in a worktree too. Its cases are the link itself, the `.gitignore` pattern that
 * keeps the link out of `git status`, the second run that leaves an existing one alone, and
 * a primary with nothing to link.
 */

const script = path.resolve(import.meta.dirname, "../../../.claude/hooks/provision-worktree.sh");

const scratch = mkdtempSync(path.join(tmpdir(), "provision-worktree-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * This repository's own `.scratch` ignore pattern, read from the root `.gitignore` rather
 * than written out here: the throwaway tree then ignores exactly what this repository
 * ignores, so a pattern narrowed back to `.scratch/` — which matches a directory and never
 * the symlink git reads as a file — fails the case below instead of passing against a copy
 * of itself.
 */
const scratchIgnorePattern = (): string => {
  const ignore = path.resolve(import.meta.dirname, "../../../.gitignore");
  const pattern = readFileSync(ignore, "utf8")
    .split("\n")
    .map((line) => line.trimEnd())
    .find((line) => line === ".scratch" || line === ".scratch/");
  if (pattern === undefined) {
    throw new Error(`${ignore} carries no \`.scratch\` pattern, so nothing here is being proved.`);
  }
  return pattern;
};

/** An origin with one commit on `main`, and a clone of it holding installed skills. */
const clonedPrimary = (name: string): string => {
  const origin = throwawayRepository(path.join(scratch, `${name}-origin`));
  writeUnder(
    origin,
    ".gitignore",
    `.claude/skills/*\n.agents/\ntasks/AGENTS.md\n${scratchIgnorePattern()}\n`,
  );
  writeUnder(origin, "skills-lock.json", '{ "version": 1, "skills": {} }\n');
  gitIn(origin, "add", "-A");
  gitIn(origin, "commit", "-q", "-m", "tracked");
  const primary = path.join(scratch, `${name}-primary`);
  gitIn(scratch, "clone", "-q", origin, primary);
  writeUnder(primary, ".agents/skills/hono/SKILL.md", "# hono\n");
  mkdirSync(path.join(primary, ".claude/skills"), { recursive: true });
  symlinkSync("../../.agents/skills/hono", path.join(primary, ".claude/skills/hono"));
  writeUnder(primary, "tasks/AGENTS.md", "# ordna\n");
  return primary;
};

/**
 * A `pnpm` and a `uv` ahead of the real ones on PATH, each saying yes and doing nothing,
 * plus whatever else the case hands over as `<tool> -> <bash body>`.
 *
 * The script puts `$HOME/Library/pnpm` and `$HOME/.local/bin` ahead of the PATH it was
 * given — the hook's PATH is not always a login shell's — which would put the machine's own
 * pnpm ahead of the stub, so the run gets an empty HOME as well and finds only the stub.
 * The empty HOME is also what keeps a run off this machine's own state: jCodeMunch keeps
 * its indexes under `$HOME`, so even a real one reached by accident would write into the
 * scratch home this file removes rather than into the owner's.
 */
const stubInstallers = (
  name: string,
  extra: Readonly<Record<string, string>> = {},
): { readonly bin: string; readonly home: string } => {
  const bin = path.join(scratch, `${name}-bin`);
  mkdirSync(bin);
  for (const [tool, body] of Object.entries({ pnpm: "exit 0\n", uv: "exit 0\n", ...extra })) {
    const file = path.join(bin, tool);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}`);
    chmodSync(file, 0o755);
  }
  const home = path.join(scratch, `${name}-home`);
  mkdirSync(home);
  return { bin, home };
};

/** A stub that appends the command line it was given to `log` and says yes. */
const recordsItsArgv = (log: string): string => `printf '%s\\n' "$*" >> '${log}'\nexit 0\n`;

const TOOL = "jcodemunch-mcp";

/**
 * The stubs first, then this machine's PATH with every directory holding a real
 * `jcodemunch-mcp` dropped. The case that asks what provisioning does without the tool
 * needs it genuinely absent, and the owner's own copy sits on the inherited PATH.
 */
const pathWithoutJcodemunch = (bin: string): string =>
  [
    bin,
    ...(process.env["PATH"] ?? "")
      .split(path.delimiter)
      .filter((directory) => directory !== "" && !existsSync(path.join(directory, TOOL))),
  ].join(path.delimiter);

type Run = { readonly status: number | null; readonly stderr: string };

const provision = (
  name: string,
  worktree: string,
  extra: Readonly<Record<string, string>> = {},
): Run => {
  const { bin, home } = stubInstallers(name, extra);
  const result = spawnSync("bash", [script, worktree], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, PATH: pathWithoutJcodemunch(bin) },
  });
  return { status: result.status, stderr: result.stderr };
};

/** The script exited zero — and when it did not, what it said is the failure's message. */
const ready = (run: Run): void => {
  if (run.status !== 0) {
    throw new Error(`provision-worktree.sh exited ${String(run.status)}:\n${run.stderr}`);
  }
};

const upstreamOf = (worktree: string): string | undefined => {
  const result = spawnSync(
    "git",
    ["-C", worktree, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : undefined;
};

describe("the upstream stage of worktree provisioning (T-099)", () => {
  it("unsets the upstream a worktree added against origin/main was given, and says so", () => {
    const primary = clonedPrimary("tracking");
    const worktree = path.join(scratch, "tracking-worktree");
    gitIn(primary, "worktree", "add", "-q", "-b", "t-tracking", worktree, "origin/main");
    expect(upstreamOf(worktree)).toBe("origin/main");

    const run = provision("tracking", worktree);

    ready(run);
    expect(run.stderr).toContain("upstream: unset — t-tracking tracked origin/main");
    expect(upstreamOf(worktree)).toBeUndefined();
  });

  it("leaves a branch that tracks nothing alone, and says that on the same line", () => {
    const primary = clonedPrimary("untracked");
    const worktree = path.join(scratch, "untracked-worktree");
    gitIn(primary, "worktree", "add", "-q", "-b", "t-untracked", worktree);
    expect(upstreamOf(worktree)).toBeUndefined();

    const run = provision("untracked", worktree);

    ready(run);
    expect(run.stderr).toContain("upstream: none — t-untracked tracks nothing");
  });
});

describe("the jCodeMunch stage of worktree provisioning (T-181)", () => {
  /** A provisioned worktree of a primary that has skills to give, and its argv log. */
  const worktreeOf = (name: string): { readonly worktree: string; readonly log: string } => {
    const primary = clonedPrimary(name);
    const worktree = path.join(scratch, `${name}-worktree`);
    gitIn(primary, "worktree", "add", "-q", "-b", `t-${name}`, worktree);
    return { worktree, log: path.join(scratch, `${name}-argv`) };
  };

  it("indexes the worktree as a root of its own, so an agent's first edit registers there", () => {
    const { worktree, log } = worktreeOf("indexed");

    const run = provision("indexed", worktree, { [TOOL]: recordsItsArgv(log) });

    ready(run);
    expect(run.stderr).toContain("jcodemunch index: done in");
    expect(readFileSync(log, "utf8")).toBe(`index ${realpathSync(worktree)}\n`);
  });

  it("provisions a worktree on a machine without jCodeMunch, saying what that costs", () => {
    const { worktree } = worktreeOf("no-jcodemunch");

    const run = provision("no-jcodemunch", worktree);

    ready(run);
    expect(run.stderr).toContain(
      "jcodemunch: not on PATH — skipped; edits here register in the primary checkout's index",
    );
  });

  it("reads the provisioning incomplete when the index fails, rather than ready", () => {
    const { worktree } = worktreeOf("failed-index");

    const run = provision("failed-index", worktree, { [TOOL]: "exit 3\n" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`jcodemunch index: FAILED — run ${TOOL} index`);
    expect(run.stderr).toContain("provision-worktree: incomplete");
  });
});

describe("the scratch stage of worktree provisioning", () => {
  /** A primary holding one discovery note, and an unprovisioned worktree of it. */
  const treesWithScratch = (
    name: string,
  ): { readonly primary: string; readonly worktree: string } => {
    const primary = clonedPrimary(name);
    writeUnder(primary, ".scratch/v01-spec/map.md", "# the map\n");
    const worktree = path.join(scratch, `${name}-worktree`);
    gitIn(primary, "worktree", "add", "-q", "-b", `t-${name}`, worktree);
    return { primary, worktree };
  };

  it("links the worktree's .scratch at the primary's, so a relative pointer resolves", () => {
    const { primary, worktree } = treesWithScratch("linked");
    const link = path.join(worktree, ".scratch");

    const run = provision("linked", worktree);

    ready(run);
    expect(run.stderr).toContain(`scratch: linked to ${realpathSync(primary)}/.scratch`);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(path.join(primary, ".scratch")));
    expect(readFileSync(path.join(link, "v01-spec/map.md"), "utf8")).toBe("# the map\n");
  });

  it("leaves the link out of git status, which is what keeps the remove hook reading no work", () => {
    const { worktree } = treesWithScratch("ignored");

    ready(provision("ignored", worktree));

    // The link is there and git says nothing about it. Asserted together, because a status
    // that is empty because nothing was linked proves the pattern nothing at all.
    expect(lstatSync(path.join(worktree, ".scratch")).isSymbolicLink()).toBe(true);
    expect(gitIn(worktree, "status", "--porcelain")).toBe("");
  });

  it("leaves a .scratch already there alone, which is what makes a second run a no-op", () => {
    const { worktree } = treesWithScratch("second-run");
    ready(provision("second-run", worktree));

    const run = provision("second-run-again", worktree);

    ready(run);
    expect(run.stderr).toContain("scratch: already here — left alone");
  });

  it("says a primary with no .scratch has nothing to link, and provisions the worktree anyway", () => {
    const primary = clonedPrimary("no-scratch");
    const worktree = path.join(scratch, "no-scratch-worktree");
    gitIn(primary, "worktree", "add", "-q", "-b", "t-no-scratch", worktree);

    const run = provision("no-scratch", worktree);

    ready(run);
    expect(run.stderr).toContain(`scratch: none at ${realpathSync(primary)} — nothing to link`);
    expect(existsSync(path.join(worktree, ".scratch"))).toBe(false);
  });
});
