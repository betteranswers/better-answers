import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { gitIn, writeUnder } from "@better-answers/devtools/throwaway-tree";
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

const script = hookScript("provision-worktree");

const scratch = scratchRoot("provision-worktree");

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

const clonedPrimary = (name: string): string => {
  const origin = repositoryHolding(path.join(scratch, `${name}-origin`), {
    ".gitignore": `.claude/skills/*\n.agents/\ntasks/AGENTS.md\n${scratchIgnorePattern()}\n`,
    "skills-lock.json": '{ "version": 1, "skills": {} }\n',
  });
  const primary = path.join(scratch, `${name}-primary`);
  gitIn(scratch, "clone", "-q", origin, primary);
  writeUnder(primary, ".agents/skills/hono/SKILL.md", "# hono\n");
  mkdirSync(path.join(primary, ".claude/skills"), { recursive: true });
  symlinkSync("../../.agents/skills/hono", path.join(primary, ".claude/skills/hono"));
  writeUnder(primary, "tasks/AGENTS.md", "# ordna\n");
  return primary;
};

const stubInstallers = (
  name: string,
  extra: Readonly<Record<string, string>> = {},
): { readonly bin: string; readonly home: string } => {
  const bin = stubsOnPath(path.join(scratch, `${name}-bin`), {
    pnpm: "exit 0\n",
    uv: "exit 0\n",
    ...extra,
  });
  const home = path.join(scratch, `${name}-home`);
  mkdirSync(home);
  return { bin, home };
};

const TOOL = "jcodemunch-mcp";

const pathWithoutJcodemunch = (bin: string): string =>
  [
    bin,
    ...(process.env["PATH"] ?? "")
      .split(path.delimiter)
      .filter((directory) => directory !== "" && !existsSync(path.join(directory, TOOL))),
  ].join(path.delimiter);

const provision = (
  name: string,
  worktree: string,
  extra: Readonly<Record<string, string>> = {},
): HookRun => {
  const { bin, home } = stubInstallers(name, extra);
  return runHook(script, {
    argv: [worktree],
    env: { HOME: home, PATH: pathWithoutJcodemunch(bin) },
  });
};

const ready = (run: HookRun): void => {
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
    const worktree = worktreeUnder(scratch, primary, "tracking", "origin/main");
    expect(upstreamOf(worktree)).toBe("origin/main");

    const run = provision("tracking", worktree);

    ready(run);
    expect(run.stderr).toContain("upstream: unset — t-tracking tracked origin/main");
    expect(upstreamOf(worktree)).toBeUndefined();
  });

  it("leaves a branch that tracks nothing alone, and says that on the same line", () => {
    const primary = clonedPrimary("untracked");
    const worktree = worktreeUnder(scratch, primary, "untracked");
    expect(upstreamOf(worktree)).toBeUndefined();

    const run = provision("untracked", worktree);

    ready(run);
    expect(run.stderr).toContain("upstream: none — t-untracked tracks nothing");
  });
});

describe("the jCodeMunch stage of worktree provisioning (T-181)", () => {
  const worktreeOf = (name: string): { readonly worktree: string; readonly log: string } => {
    const worktree = worktreeUnder(scratch, clonedPrimary(name), name);
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
  const treesWithScratch = (
    name: string,
  ): { readonly primary: string; readonly worktree: string } => {
    const primary = clonedPrimary(name);
    writeUnder(primary, ".scratch/v01-spec/map.md", "# the map\n");
    return { primary, worktree: worktreeUnder(scratch, primary, name) };
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
    const worktree = worktreeUnder(scratch, primary, "no-scratch");

    const run = provision("no-scratch", worktree);

    ready(run);
    expect(run.stderr).toContain(`scratch: none at ${realpathSync(primary)} — nothing to link`);
    expect(existsSync(path.join(worktree, ".scratch"))).toBe(false);
  });
});
