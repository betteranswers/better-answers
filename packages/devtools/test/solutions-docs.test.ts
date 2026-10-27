import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { markdownUnder, repositoryRoot } from "@better-answers/devtools/paths";

const SOLUTIONS = "docs/solutions";
const DECISIONS = "docs/solutions/architecture-patterns";

const FRONTMATTER = /^---\n(?<yaml>[\s\S]*?)\n---(?:\n|$)/;

const appliesWhen = z.array(z.string().refine((line) => line.trim().length > 0)).min(1);

const frontmatterSchema = z.object({ applies_when: appliesWhen });

const SETTLED_STATUSES = ["proposed", "accepted", "deprecated"] as const;

const decisionSchema = z.strictObject({
  status: z.union([z.enum(SETTLED_STATUSES), z.string().regex(/^superseded by adr-\d{4}\.md$/)]),
  title: z.string().refine((title) => title.trim().length > 0),
  applies_when: appliesWhen,
});

const read = (relative: string): { readonly frontmatter: unknown; readonly body: string } => {
  const text = readFileSync(path.join(repositoryRoot, relative), "utf8");
  const match = FRONTMATTER.exec(text);
  return {
    frontmatter: match?.groups?.["yaml"] === undefined ? undefined : parse(match.groups["yaml"]),
    body: match === null ? text : text.slice(match[0].length),
  };
};

const lacksAppliesWhen = (relative: string): boolean =>
  !frontmatterSchema.safeParse(read(relative).frontmatter).success;

const breaksDecisionFormat = (relative: string): boolean => {
  const { frontmatter, body } = read(relative);
  return (
    !/^adr-\d{4}\.md$/.test(path.basename(relative)) ||
    !decisionSchema.safeParse(frontmatter).success ||
    /^# /m.test(body)
  );
};

describe("docs/solutions", () => {
  it("gives every doc an applies_when list", () => {
    const docs = markdownUnder(repositoryRoot, SOLUTIONS);

    expect(docs.length).toBeGreaterThan(0);
    expect(
      docs.filter(lacksAppliesWhen),
      "each doc listed lacks a non-empty applies_when. Add an applies_when list to its frontmatter, one quoted line per situation in which an agent should read the doc.",
    ).toEqual([]);
  });

  it("holds every architecture decision to the ADR format", () => {
    const decisions = markdownUnder(repositoryRoot, DECISIONS);

    expect(decisions.length).toBeGreaterThan(0);
    expect(
      decisions.filter(breaksDecisionFormat),
      "each doc listed breaks .agents/references/adr-format.md. Name it adr-NNNN.md, give it only status, title and applies_when in its frontmatter, and leave the title out of its body.",
    ).toEqual([]);
  });
});
