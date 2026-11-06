import { describe, expect, it } from "vitest";

import {
  FIX_COMMAND,
  findingsFor,
  pathsIn,
  pathsLine,
  SCOPES,
  withPaths,
} from "@better-answers/devtools/skill-paths";
import type { SkillOnDisk, SkillScope } from "@better-answers/devtools/skill-paths";

const skill = (frontmatter: string): string => `---\n${frontmatter}\n---\n\n# Body\n`;

const TABLE: readonly SkillScope[] = [
  { skill: "hono", paths: ["apps/api/**", "packages/core/**"] },
  { skill: "verify", paths: [] },
  { skill: "mine", paths: ["deploy/**"], local: true },
];

describe("the paths line of a skill", () => {
  it.each([
    ['name: a\npaths: "apps/api/**, packages/core/**"', ["apps/api/**", "packages/core/**"]],
    [
      "name: a\npaths:\n  - apps/api/**\n  - 'packages/core/**'",
      ["apps/api/**", "packages/core/**"],
    ],
    ["name: a\npaths: apps/api/**", ["apps/api/**"]],
    ["name: a", []],
  ])("reads %j", (frontmatter, expected) => {
    expect(pathsIn(skill(frontmatter))).toEqual(expected);
  });

  it("writes the line last and leaves the body alone", () => {
    const written = withPaths(skill("name: a\ndescription: >\n  long\n  text"), ["apps/web/**"]);

    expect(written).toBe(
      `---\nname: a\ndescription: >\n  long\n  text\n${pathsLine(["apps/web/**"])}\n---\n\n# Body\n`,
    );
  });

  it("replaces an upstream block list idempotently", () => {
    const upstream = skill("name: a\npaths:\n  - old/**\ndescription: d");

    const once = withPaths(upstream, ["apps/api/**"]);

    expect(once).toBe(skill('name: a\ndescription: d\npaths: "apps/api/**"'));
    expect(withPaths(once, ["apps/api/**"])).toBe(once);
  });

  it("drops the line for a skill whose row is empty", () => {
    expect(withPaths(skill('name: a\npaths: "x/**"'), [])).toBe(skill("name: a"));
  });

  it("refuses a file with no frontmatter", () => {
    expect(() => withPaths("# Body\n", ["a/**"])).toThrow("no frontmatter");
  });
});

describe("the gate", () => {
  const entry = (name: string, frontmatter: string): SkillOnDisk => ({
    skill: name,
    tracked: true,
    symlink: false,
    text: skill(frontmatter),
  });
  const held = 'name: hono\npaths: "apps/api/**, packages/core/**"';

  it("passes when every skill holds its row", () => {
    expect(findingsFor([entry("hono", held), entry("verify", "name: verify")], TABLE)).toEqual([]);
  });

  it("names the fix command when a line is gone", () => {
    const found = findingsFor(
      [entry("hono", "name: hono"), entry("verify", "name: verify")],
      TABLE,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(".claude/skills/hono/SKILL.md");
    expect(found[0]).toContain(FIX_COMMAND);
  });

  it("fails a line its row does not give", () => {
    const found = findingsFor(
      [entry("hono", held), entry("verify", 'name: verify\npaths: "apps/api/**"')],
      TABLE,
    );

    expect(found[0]).toContain("expects no paths line");
  });

  it("fails a skill with no row", () => {
    const found = findingsFor(
      [entry("hono", held), entry("verify", "name: verify"), entry("new-one", "name: new-one")],
      TABLE,
    );

    expect(found[0]).toContain("no row");
  });

  it("refuses a symlinked skill folder and names the recovery", () => {
    const found = findingsFor(
      [{ ...entry("hono", held), symlink: true }, entry("verify", "name: verify")],
      TABLE,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("symlink");
    expect(found[0]).toContain("git checkout HEAD -- .claude/skills/hono");
    expect(found[0]).toContain("skills-update");
    expect(found[0]).not.toContain("Delete the row");
  });

  it("refuses a tracked skill with no SKILL.md", () => {
    const found = findingsFor(
      [{ ...entry("hono", held), text: null, symlink: true }, entry("verify", "name: verify")],
      TABLE,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("git checkout HEAD -- .claude/skills/hono");
    expect(found[0]).not.toContain("Delete the row");
  });

  it("fails a tracked row with no tracked skill", () => {
    const found = findingsFor([entry("hono", held)], TABLE);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("verify");
  });
});

describe("the table", () => {
  it("names each skill once", () => {
    const names = SCOPES.map((one) => one.skill);

    expect(new Set(names).size).toBe(names.length);
  });
});
