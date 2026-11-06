import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";

describe("the tracked skills' licence files", () => {
  const tracked = (directory: string): readonly string[] => {
    const listed = spawnSync("git", ["-C", repositoryRoot, "ls-files", directory], {
      encoding: "utf8",
    });
    if (listed.status !== 0) throw new Error(`git ls-files ${directory} failed:\n${listed.stderr}`);
    return listed.stdout.split("\n").filter((line) => line !== "");
  };

  it("tracks the pixel-perfect plugin with its licence and notice", () => {
    const files = tracked(".claude/skills/pixel-perfect");

    expect(files).toContain(".claude/skills/pixel-perfect/.claude-plugin/plugin.json");
    expect(files).toContain(".claude/skills/pixel-perfect/LICENSE");
    expect(files).toContain(".claude/skills/pixel-perfect/NOTICE.md");
    for (const skill of ["screenshot-diff", "visual-qa"]) {
      expect(files).toContain(`.claude/skills/pixel-perfect/skills/${skill}/SKILL.md`);
    }
    expect(files.filter((file) => file.endsWith("/SKILL.md"))).toHaveLength(2);
  });
});
