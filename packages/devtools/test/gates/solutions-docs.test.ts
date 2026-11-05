import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { lineReferencesIn } from "@better-answers/devtools/line-references";
import { markdownUnder, repositoryRoot } from "@better-answers/devtools/paths";

const SOLUTIONS = "docs/solutions";

const FRONTMATTER = /^---\n(?<yaml>[\s\S]*?)\n---(?:\n|$)/;

const SETTLED_STATUSES = ["proposed", "accepted", "deprecated"] as const;

const decisionSchema = z.strictObject({
  status: z.union([z.enum(SETTLED_STATUSES), z.string().regex(/^superseded by adr-\d{4}\.md$/)]),
  title: z.string().refine((title) => title.trim().length > 0),
  applies_when: z.array(z.string().refine((line) => line.trim().length > 0)).min(1),
});

const read = (relative: string): { readonly frontmatter: unknown; readonly body: string } => {
  const text = readFileSync(path.join(repositoryRoot, relative), "utf8");
  const match = FRONTMATTER.exec(text);
  return {
    frontmatter: match?.groups?.["yaml"] === undefined ? undefined : parse(match.groups["yaml"]),
    body: match === null ? text : text.slice(match[0].length),
  };
};

const citingALine = (relative: string): readonly string[] =>
  lineReferencesIn(readFileSync(path.join(repositoryRoot, relative), "utf8")).map(
    ({ line, text }) => `${relative}, line ${String(line)}: ${text}`,
  );

const breaksDecisionFormat = (relative: string): boolean => {
  const { frontmatter, body } = read(relative);
  return (
    !/^adr-\d{4}\.md$/.test(path.basename(relative)) ||
    !decisionSchema.safeParse(frontmatter).success ||
    /^# /m.test(body)
  );
};

describe("docs/solutions", () => {
  it("cites code by path and symbol, not by line number", () => {
    const docs = markdownUnder(repositoryRoot, SOLUTIONS);

    expect(docs.length).toBeGreaterThan(0);
    expect(
      docs.flatMap(citingALine),
      "each reference listed names a line, and a line number names other code after the next edit above it. Cite the path and the symbol that holds the code, or a test by its title.",
    ).toEqual([]);
  });

  it("holds every doc to the ADR format", () => {
    const decisions = markdownUnder(repositoryRoot, SOLUTIONS);

    expect(decisions.length).toBeGreaterThan(0);
    expect(
      decisions.filter(breaksDecisionFormat),
      "docs/solutions holds architecture decisions only, and each doc listed breaks .agents/references/adr-format.md. Name it adr-NNNN.md, give it only status, title and applies_when in its frontmatter, and leave the title out of its body.",
    ).toEqual([]);
  });
});
