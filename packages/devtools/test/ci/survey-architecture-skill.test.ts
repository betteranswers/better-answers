import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";

const skillDirectory = ".claude/skills/survey-architecture";

const skillFiles = ["SKILL.md", "references/deepening.md", "references/report.md"].map((file) =>
  path.join(skillDirectory, file),
);

const QUOTED = /`(?<token>[^`]+)`/g;

const withoutFences = (text: string): string => {
  const kept: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    else if (!inFence) kept.push(line);
  }
  return kept.join("\n");
};

const looksLikePath = (token: string): boolean =>
  !/[\s<>$*]/.test(token) &&
  !token.startsWith("/") &&
  !token.startsWith("-") &&
  (token.includes("/") || /.\.[a-z]+$/.test(token));

const fromRoot = (token: string): string =>
  token.startsWith("references/") || token.startsWith("scripts/")
    ? path.join(skillDirectory, token)
    : token;

const ignored = (file: string): boolean =>
  spawnSync("git", ["-C", repositoryRoot, "check-ignore", "-q", "--no-index", file]).status === 0;

const named = skillFiles.flatMap((file) =>
  [...withoutFences(readFileSync(path.join(repositoryRoot, file), "utf8")).matchAll(QUOTED)]
    .map((match) => match.groups?.["token"] ?? "")
    .filter(looksLikePath)
    .map(fromRoot),
);

describe("the survey-architecture skill", () => {
  it("points at files that are in the tree", () => {
    const missing = [...new Set(named)].filter(
      (file) => !existsSync(path.join(repositoryRoot, file)) && !ignored(file),
    );
    expect(missing, `${skillDirectory} names paths that do not exist`).toEqual([]);
  });

  it("names the rules, decisions and script it relies on", () => {
    expect(named).toEqual(
      expect.arrayContaining([
        "CODING_STANDARDS.md",
        "CONTEXT.md",
        "docs/solutions/architecture-patterns/",
        `${skillDirectory}/references/deepening.md`,
        `${skillDirectory}/scripts/churn.sh`,
      ]),
    );
  });

  it("skips a git-ignored path instead of failing on it", () => {
    expect(named).toContain(".lavish/");
    expect(ignored(".lavish/")).toBe(true);
  });
});
