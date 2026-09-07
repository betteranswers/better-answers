import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * The skills stage of worktree provisioning, run over a throwaway primary checkout and a
 * worktree of it (T-083, `[CHECK1]`).
 *
 * A `git worktree add` checks out tracked files only, and the agent tooling this repository
 * runs on is installed and ignored (ADR 0027): `.agents/skills/`, the symlinks under
 * `.claude/skills/` that point into it, the plugin skills that live there directly, and
 * `tasks/AGENTS.md`. `.claude/hooks/provision-skills.sh` copies them from the primary
 * checkout — the one `git rev-parse --git-common-dir` names — and is the stage
 * `provision-worktree.sh` runs after the installs. It is run here rather than read, because
 * everything it promises is about a filesystem: what was copied, what was left alone, and
 * whether a link that was right in one tree is still right in the other.
 *
 * The primary checkout is a throwaway git repository shaped like this one where it matters:
 * one skill tracked under `.claude/skills/`, the rest installed and ignored. Nothing here
 * touches the real checkout or its worktrees.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const script = path.join(repositoryRoot, ".claude/hooks/provision-skills.sh");

const scratch = mkdtempSync(path.join(tmpdir(), "provision-skills-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const git = (directory: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
};

const write = (root: string, relative: string, content: string): void => {
  const destination = path.join(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
};

/** A relative symlink from `.claude/skills/<name>` into `.agents/skills/<name>`. */
const linkSkill = (root: string, name: string, target = `../../.agents/skills/${name}`): void => {
  mkdirSync(path.join(root, ".claude/skills"), { recursive: true });
  symlinkSync(target, path.join(root, ".claude/skills", name));
};

const IGNORE = [
  ".claude/skills/*",
  "!.claude/skills/browser-suite/",
  ".agents/",
  "tasks/AGENTS.md",
  "",
].join("\n");

const TRACKED_SKILL = "# browser-suite\n\nThe one skill this repository wrote.\n";

/**
 * A primary checkout: one commit holding the tracked skill, the ignore block and the
 * manifest, then the installed tooling on top, untracked and ignored.
 */
const primaryCheckout = (name: string, installed: boolean): string => {
  const root = path.join(scratch, name);
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "provision-skills test");
  write(root, ".gitignore", IGNORE);
  write(root, ".claude/skills/browser-suite/SKILL.md", TRACKED_SKILL);
  write(root, "skills-lock.json", '{ "version": 1, "skills": {} }\n');
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "tracked");
  if (installed) {
    write(root, ".agents/skills/hono/SKILL.md", "# hono\n");
    write(root, ".agents/skills/auth/SKILL.md", "# auth\n");
    linkSkill(root, "hono");
    linkSkill(root, "auth");
    write(root, ".claude/skills/gitnexus/SKILL.md", "# gitnexus — a plugin install\n");
    write(root, "tasks/AGENTS.md", "# ordna\n");
  }
  return root;
};

const worktreeOf = (primary: string, name: string): string => {
  const directory = path.join(scratch, name);
  git(primary, "worktree", "add", "-q", "-b", name, directory);
  return directory;
};

type Run = { readonly status: number | null; readonly stderr: string };

const provision = (worktree: string, env: Readonly<Record<string, string>> = {}): Run => {
  const result = spawnSync("bash", [script, worktree], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stderr: result.stderr };
};

/** Every path under `root`, relative, with what it is — enough to prove a tree unchanged. */
const snapshot = (root: string): readonly string[] => {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.name === ".git") return [];
      const relative = path.relative(root, full);
      if (entry.isSymbolicLink()) return [`${relative} -> ${readlinkSync(full)}`];
      if (entry.isDirectory()) return walk(full);
      return [`${relative} = ${readFileSync(full, "utf8")}`];
    });
  return walk(root).sort();
};

const isSymlink = (file: string): boolean => lstatSync(file).isSymbolicLink();

/** The stage exited zero — and when it did not, what it said is the failure's message. */
const ready = (run: Run): void => {
  if (run.status !== 0) {
    throw new Error(`provision-skills.sh exited ${String(run.status)}:\n${run.stderr}`);
  }
};

describe("the skills stage of worktree provisioning (T-083)", () => {
  it("copies the installed tooling from the primary checkout into the worktree", () => {
    const primary = primaryCheckout("copies-primary", true);
    const worktree = worktreeOf(primary, "copies-worktree");
    expect(existsSync(path.join(worktree, ".agents"))).toBe(false);

    const run = provision(worktree);

    ready(run);
    expect(readFileSync(path.join(worktree, ".agents/skills/hono/SKILL.md"), "utf8")).toBe(
      "# hono\n",
    );
    expect(readFileSync(path.join(worktree, ".agents/skills/auth/SKILL.md"), "utf8")).toBe(
      "# auth\n",
    );
    expect(readFileSync(path.join(worktree, ".claude/skills/gitnexus/SKILL.md"), "utf8")).toBe(
      "# gitnexus — a plugin install\n",
    );
    expect(readFileSync(path.join(worktree, "tasks/AGENTS.md"), "utf8")).toBe("# ordna\n");
    expect(run.stderr).toContain("skills:");
  });

  it("copies a skill link as a link, still relative, resolving inside the worktree", () => {
    const primary = primaryCheckout("links-primary", true);
    const worktree = worktreeOf(primary, "links-worktree");

    const run = provision(worktree);

    ready(run);
    const link = path.join(worktree, ".claude/skills/hono");
    expect(isSymlink(link)).toBe(true);
    expect(readlinkSync(link)).toBe("../../.agents/skills/hono");
    const resolved = realpathSync(link);
    expect(resolved.startsWith(realpathSync(worktree) + path.sep)).toBe(true);
    expect(resolved.startsWith(realpathSync(primary) + path.sep)).toBe(false);
  });

  it("never overwrites what the checkout already carries", () => {
    const primary = primaryCheckout("tracked-primary", true);
    const worktree = worktreeOf(primary, "tracked-worktree");
    // An uncommitted edit in the primary: the worktree's copy is its checkout's, not this.
    write(primary, ".claude/skills/browser-suite/SKILL.md", "# edited in the primary\n");

    const run = provision(worktree);

    ready(run);
    expect(readFileSync(path.join(worktree, ".claude/skills/browser-suite/SKILL.md"), "utf8")).toBe(
      TRACKED_SKILL,
    );
  });

  it("is idempotent: a second run changes nothing and fails nothing", () => {
    const primary = primaryCheckout("twice-primary", true);
    const worktree = worktreeOf(primary, "twice-worktree");
    expect(provision(worktree).status).toBe(0);
    const before = snapshot(worktree);

    const again = provision(worktree);

    ready(again);
    expect(snapshot(worktree)).toEqual(before);
    expect(again.stderr).toContain("nothing to copy");
  });

  it("fails, naming the link, when a skill link would not resolve inside the worktree", () => {
    const primary = primaryCheckout("absolute-primary", true);
    // An absolute link works in the primary and points a worktree back at the primary's
    // files — the one thing a copied link must never do.
    linkSkill(primary, "absolute", path.join(primary, ".agents/skills/hono"));
    const worktree = worktreeOf(primary, "absolute-worktree");

    const run = provision(worktree);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(".claude/skills/absolute");
  });

  it("fails, naming the link, when a copied skill link dangles", () => {
    const primary = primaryCheckout("dangling-primary", true);
    linkSkill(primary, "gone");
    const worktree = worktreeOf(primary, "dangling-worktree");

    const run = provision(worktree);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(".claude/skills/gone");
  });

  describe("when the primary checkout has no skills to give", () => {
    /**
     * A `npx` ahead of the real one on PATH, so the fallback's reinstall is observed and
     * never reaches the network. The stub records what it was asked and either plays the
     * installer — writing the skills the lock would restore — or refuses.
     */
    const stubNpx = (name: string, succeeds: boolean): string => {
      const bin = path.join(scratch, `${name}-bin`);
      mkdirSync(bin);
      const npx = path.join(bin, "npx");
      writeFileSync(
        npx,
        [
          "#!/usr/bin/env bash",
          'printf \'%s\\n\' "$*" > "$PWD/npx-was-asked"',
          ...(succeeds
            ? [
                "mkdir -p .agents/skills/hono .claude/skills",
                "printf '# hono\\n' > .agents/skills/hono/SKILL.md",
                "ln -s ../../.agents/skills/hono .claude/skills/hono",
                "exit 0",
              ]
            : ["exit 1"]),
          "",
        ].join("\n"),
      );
      chmodSync(npx, 0o755);
      return bin;
    };

    it("reinstalls from the tracked manifest", () => {
      const primary = primaryCheckout("bare-primary", false);
      const worktree = worktreeOf(primary, "bare-worktree");
      const bin = stubNpx("bare", true);

      const run = provision(worktree, { PATH: `${bin}:${process.env["PATH"] ?? ""}` });

      ready(run);
      expect(readFileSync(path.join(worktree, "npx-was-asked"), "utf8")).toContain(
        "experimental_install",
      );
      expect(isSymlink(path.join(worktree, ".claude/skills/hono"))).toBe(true);
    });

    it("says plainly that it could not, and exits non-zero, when the reinstall fails", () => {
      const primary = primaryCheckout("refused-primary", false);
      const worktree = worktreeOf(primary, "refused-worktree");
      const bin = stubNpx("refused", false);

      const run = provision(worktree, { PATH: `${bin}:${process.env["PATH"] ?? ""}` });

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("skills-lock.json");
      expect(run.stderr).toMatch(/FAILED|could not/);
    });
  });
});
