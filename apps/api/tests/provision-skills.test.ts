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

import {
  gitIn as git,
  throwawayRepository,
  writeUnder as write,
} from "@better-answers/devtools/throwaway-tree";
import { afterAll, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const script = path.join(repositoryRoot, ".claude/hooks/provision-skills.sh");

const scratch = mkdtempSync(path.join(tmpdir(), "provision-skills-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const linkSkill = (
  root: string,
  name: string,
  target = `../../.agents/skills/${name}`,
  under = ".claude/skills",
): void => {
  mkdirSync(path.join(root, under), { recursive: true });
  symlinkSync(target, path.join(root, under, name));
};

const IGNORE = [
  ".claude/skills/*",
  "!.claude/skills/browser-suite/",
  "apps/*/.claude/skills/*",
  ".agents/",
  "",
].join("\n");

const TRACKED_SKILL = "# browser-suite\n\nThe one skill this repository wrote.\n";

const API_SKILL = "# trpc-router — the api's, co-located\n";
const WORKER_SKILL = "# cocoindex — the worker's, co-located\n";

const primaryCheckout = (name: string, installed: boolean): string => {
  const root = throwawayRepository(path.join(scratch, name));
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
    write(root, "apps/api/.claude/skills/trpc-router/SKILL.md", API_SKILL);
    linkSkill(root, "hono", "../../../../.agents/skills/hono", "apps/api/.claude/skills");
    write(root, "apps/worker/.claude/skills/cocoindex/SKILL.md", WORKER_SKILL);
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
    expect(run.stderr).toContain("skills:");
  });

  it("copies a skill link as a link, still relative, resolving inside the worktree", () => {
    const primary = primaryCheckout("links-primary", true);

    linkSkill(primary, "guide", "../../.agents/skills/hono/SKILL.md");
    const worktree = worktreeOf(primary, "links-worktree");

    const run = provision(worktree);

    ready(run);
    const link = path.join(worktree, ".claude/skills/hono");
    expect(isSymlink(link)).toBe(true);
    expect(readlinkSync(link)).toBe("../../.agents/skills/hono");
    const resolved = realpathSync(link);
    expect(resolved.startsWith(realpathSync(worktree) + path.sep)).toBe(true);
    expect(resolved.startsWith(realpathSync(primary) + path.sep)).toBe(false);
    expect(isSymlink(path.join(worktree, ".claude/skills/guide"))).toBe(true);
  });

  it("copies each workspace's co-located skills too, a link among them resolving inside the worktree", () => {
    const primary = primaryCheckout("workspaces-primary", true);
    const worktree = worktreeOf(primary, "workspaces-worktree");
    expect(existsSync(path.join(worktree, "apps/api/.claude/skills"))).toBe(false);

    const run = provision(worktree);

    ready(run);
    expect(
      readFileSync(path.join(worktree, "apps/api/.claude/skills/trpc-router/SKILL.md"), "utf8"),
    ).toBe(API_SKILL);
    expect(
      readFileSync(path.join(worktree, "apps/worker/.claude/skills/cocoindex/SKILL.md"), "utf8"),
    ).toBe(WORKER_SKILL);
    const link = path.join(worktree, "apps/api/.claude/skills/hono");
    expect(isSymlink(link)).toBe(true);
    expect(readlinkSync(link)).toBe("../../../../.agents/skills/hono");
    const resolved = realpathSync(link);
    expect(resolved.startsWith(realpathSync(worktree) + path.sep)).toBe(true);
    expect(resolved.startsWith(realpathSync(primary) + path.sep)).toBe(false);
  });

  it("fails, naming the link, when a workspace's skill link dangles", () => {
    const primary = primaryCheckout("workspace-dangling-primary", true);

    linkSkill(primary, "gone", "../../.agents/skills/gone", "apps/web/.claude/skills");
    const worktree = worktreeOf(primary, "workspace-dangling-worktree");

    const run = provision(worktree);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("apps/web/.claude/skills/gone");
  });

  it("never overwrites what the checkout already carries", () => {
    const primary = primaryCheckout("tracked-primary", true);
    const worktree = worktreeOf(primary, "tracked-worktree");

    write(primary, ".claude/skills/browser-suite/SKILL.md", "# edited in the primary\n");

    const run = provision(worktree);

    ready(run);
    expect(readFileSync(path.join(worktree, ".claude/skills/browser-suite/SKILL.md"), "utf8")).toBe(
      TRACKED_SKILL,
    );
  });

  it("carries a skill installed in the primary after the worktree was provisioned", () => {
    const primary = primaryCheckout("later-primary", true);
    const worktree = worktreeOf(primary, "later-worktree");
    ready(provision(worktree));

    write(primary, ".agents/skills/later/SKILL.md", "# later\n");
    linkSkill(primary, "later");
    linkSkill(primary, "later-too", "../../../../.agents/skills/later", "apps/web/.claude/skills");

    const run = provision(worktree);

    ready(run);
    expect(readFileSync(path.join(worktree, ".agents/skills/later/SKILL.md"), "utf8")).toBe(
      "# later\n",
    );
    expect(readFileSync(path.join(worktree, ".claude/skills/later/SKILL.md"), "utf8")).toBe(
      "# later\n",
    );
    expect(
      readFileSync(path.join(worktree, "apps/web/.claude/skills/later-too/SKILL.md"), "utf8"),
    ).toBe("# later\n");
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
    type Installer = "installs" | "refuses" | "installs nothing";

    const executable = (file: string, lines: readonly string[]): void => {
      writeFileSync(file, ["#!/usr/bin/env bash", ...lines, ""].join("\n"));
      chmodSync(file, 0o755);
    };

    const stubInstallers = (name: string, installer: Installer): string => {
      const bin = path.join(scratch, `${name}-bin`);
      mkdirSync(bin);
      const install = {
        installs: [
          "mkdir -p .agents/skills/hono .claude/skills",
          "printf '# hono\\n' > .agents/skills/hono/SKILL.md",
          "ln -s ../../.agents/skills/hono .claude/skills/hono",
          "exit 0",
        ],
        refuses: ["exit 1"],
        "installs nothing": ["echo 'No project skills found in skills-lock.json'", "exit 0"],
      }[installer];
      executable(path.join(bin, "npx"), [
        'printf \'%s\\n\' "$*" > "$PWD/npx-was-asked"',
        ...install,
      ]);
      return bin;
    };

    const bare = (name: string, installer: Installer): { worktree: string; run: Run } => {
      const primary = primaryCheckout(`${name}-primary`, false);
      const worktree = worktreeOf(primary, `${name}-worktree`);
      const bin = stubInstallers(name, installer);
      const run = provision(worktree, { PATH: `${bin}:${process.env["PATH"] ?? ""}` });
      return { worktree, run };
    };

    it("reinstalls from the tracked manifest", () => {
      const { worktree, run } = bare("restored", "installs");

      ready(run);
      expect(readFileSync(path.join(worktree, "npx-was-asked"), "utf8")).toContain(
        "experimental_install",
      );
      expect(isSymlink(path.join(worktree, ".claude/skills/hono"))).toBe(true);
    });

    it("does not read an installer's zero exit as skills when it installed none", () => {
      const { run } = bare("empty", "installs nothing");

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("FAILED");
      expect(run.stderr).toContain(".agents/skills empty");
    });

    it("still copies what the primary does have before reinstalling the rest", () => {
      const primary = primaryCheckout("partial-primary", false);
      write(primary, ".claude/skills/gitnexus/SKILL.md", "# gitnexus\n");
      const worktree = worktreeOf(primary, "partial-worktree");
      const bin = stubInstallers("partial", "installs");

      const run = provision(worktree, { PATH: `${bin}:${process.env["PATH"] ?? ""}` });

      ready(run);
      expect(readFileSync(path.join(worktree, ".claude/skills/gitnexus/SKILL.md"), "utf8")).toBe(
        "# gitnexus\n",
      );
      expect(isSymlink(path.join(worktree, ".claude/skills/hono"))).toBe(true);
    });

    it("says plainly that it could not, and exits non-zero, when the reinstall fails", () => {
      const { run } = bare("refused", "refuses");

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("skills-lock.json");
      expect(run.stderr).toMatch(/FAILED|could not/);
    });
  });
});

describe("the skills this repository tracks (T-081, T-384)", () => {
  const tracked = (directory: string): readonly string[] => {
    const listed = spawnSync("git", ["-C", repositoryRoot, "ls-files", directory], {
      encoding: "utf8",
    });
    if (listed.status !== 0) throw new Error(`git ls-files ${directory} failed:\n${listed.stderr}`);
    return listed.stdout.split("\n").filter((line) => line !== "");
  };

  it("offers the design system's skill through a link that resolves inside the checkout", () => {
    const link = path.join(repositoryRoot, ".claude/skills/better-answers-design");

    expect(isSymlink(link)).toBe(true);

    expect(readlinkSync(link)).toBe("../../packages/design-system");
    expect(readFileSync(path.join(link, "SKILL.md"), "utf8")).toContain(
      "name: better-answers-design",
    );
  });

  it("tracks its own three skills, for clones without an installer", () => {
    const skills = tracked(".claude/skills");

    expect(skills).toContain(".claude/skills/better-answers-design");
    expect(skills).toContain(".claude/skills/browser-suite/SKILL.md");
    expect(skills).toContain(".claude/skills/renovate-prs/SKILL.md");
  });

  it("tracks five third-party skills, so every agent loads one copy", () => {
    const skills = tracked(".claude/skills");

    expect(skills).toContain(".claude/skills/code-comments/SKILL.md");
    expect(skills).toContain(".claude/skills/complexity-gate/SKILL.md");
    expect(skills).toContain(".claude/skills/human-writing/SKILL.md");
    expect(skills).toContain(".claude/skills/mutation-testing/SKILL.md");
    expect(skills).toContain(".claude/skills/repo-quality-sweep/SKILL.md");
  });

  it("tracks nothing else, since every other skill installs per checkout", () => {
    const ours = tracked(".claude/skills").map((file) => file.split("/")[2] ?? "");

    expect([...new Set(ours)].sort()).toEqual([
      "better-answers-design",
      "browser-suite",
      "code-comments",
      "complexity-gate",
      "human-writing",
      "mutation-testing",
      "renovate-prs",
      "repo-quality-sweep",
    ]);
  });
});
