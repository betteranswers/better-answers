import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";

const SOLUTIONS = "docs/solutions";

const FRONTMATTER = /^---\n(?<yaml>[\s\S]*?)\n---(?:\n|$)/;

const frontmatterSchema = z.object({
  applies_when: z.array(z.string().refine((line) => line.trim().length > 0)).min(1),
});

const solutionDocs = (): readonly string[] =>
  readdirSync(path.join(repositoryRoot, SOLUTIONS), { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => path.posix.join(SOLUTIONS, entry.split(path.sep).join("/")))
    .sort();

const lacksAppliesWhen = (relative: string): boolean => {
  const text = readFileSync(path.join(repositoryRoot, relative), "utf8");
  const yaml = FRONTMATTER.exec(text)?.groups?.["yaml"];
  return yaml === undefined || !frontmatterSchema.safeParse(parse(yaml)).success;
};

describe("docs/solutions", () => {
  it("gives every doc an applies_when list", () => {
    const docs = solutionDocs();

    expect(docs.length).toBeGreaterThan(0);
    expect(
      docs.filter(lacksAppliesWhen),
      "each doc listed lacks a non-empty applies_when. Add an applies_when list to its frontmatter, one quoted line per situation in which an agent should read the doc.",
    ).toEqual([]);
  });
});
