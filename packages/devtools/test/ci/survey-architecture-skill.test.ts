import { describe, expect, it } from "vitest";

import { ignored, missingPaths, namedPaths } from "./skill-pointers.ts";

const skillDirectory = ".claude/skills/survey-architecture";

const named = namedPaths(skillDirectory, [
  "SKILL.md",
  "references/deepening.md",
  "references/report.md",
]);

describe("the survey-architecture skill", () => {
  it("points at files that are in the tree", () => {
    expect(missingPaths(named), `${skillDirectory} names paths that do not exist`).toEqual([]);
  });

  it("names the rules, decisions and script it relies on", () => {
    expect(named).toEqual(
      expect.arrayContaining([
        "CODING_STANDARDS.md",
        "CONCEPTS.md",
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
