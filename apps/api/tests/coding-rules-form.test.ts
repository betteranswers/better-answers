import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const ROOT_FILE = "CODING_RULES.md";
const ROOT_BUDGET = 2500;
const RULE_BUDGET = 80;

// The list only shrinks: the last case here fails an entry whose rule now fits.
const OVER_BUDGET: readonly string[] = ["SEC3"];

const ADVERBS: ReadonlySet<string> = new Set(["Never", "Always", "Only"]);

const IMPERATIVES: ReadonlySet<string> = new Set([
  "Assert",
  "Audit",
  "Build",
  "Carry",
  "Catch",
  "Check",
  "Choose",
  "Comment",
  "Compose",
  "Declare",
  "Derive",
  "Design",
  "Export",
  "Fail",
  "Follow",
  "Give",
  "Import",
  "Introduce",
  "Keep",
  "Land",
  "Log",
  "Meet",
  "Migrate",
  "Mint",
  "Mock",
  "Mutate",
  "Name",
  "Own",
  "Parse",
  "Pin",
  "Read",
  "Rebuild",
  "Refuse",
  "Return",
  "Run",
  "Ship",
  "Suffix",
  "Take",
  "Test",
  "Title",
  "Triage",
  "Turn",
  "Type",
  "Widen",
  "Write",
]);

const BANNED: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: "a ticket id", pattern: /\bT-\d{3,}\b/g },
  { what: "an ADR number", pattern: /\bADRs?[ -]\d{4}\b/g },
  { what: "a date", pattern: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g },
];

const FENCE = /^ {0,3}(?:```|~~~)/;
const HEADING = /^(?<hashes>#{1,6}) +(?<text>.+?) *$/;
const TAGGED = /^\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\] +(?<title>.+)$/;
const FAMILY = /^[A-Z][A-Z0-9]*$/;

type Line = { readonly number: number; readonly text: string };

type Rule = {
  readonly file: string;
  readonly tag: string;
  readonly title: string;
  readonly line: number;
  readonly prose: string;
};

type Heading = { readonly line: number; readonly level: number; readonly text: string };

// A fenced snippet is free of every budget and of the banned references, so it leaves the
// prose before anything is counted or scanned.
const withoutFences = (text: string): readonly Line[] => {
  let inside = false;
  return text.split("\n").flatMap((text_, index) => {
    if (FENCE.test(text_)) {
      inside = !inside;
      return [];
    }
    return inside ? [] : [{ number: index + 1, text: text_ }];
  });
};

const countWords = (text: string): number =>
  text.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;

const headingsIn = (lines: readonly Line[]): readonly Heading[] =>
  lines.flatMap((line) => {
    const match = HEADING.exec(line.text);
    const hashes = match?.groups?.["hashes"];
    const text = match?.groups?.["text"];
    return hashes === undefined || text === undefined
      ? []
      : [{ line: line.number, level: hashes.length, text }];
  });

const rulesIn = (file: string, lines: readonly Line[]): readonly Rule[] => {
  const headings = headingsIn(lines);
  return headings.flatMap((heading, index) => {
    const match = TAGGED.exec(heading.text);
    const tag = match?.groups?.["tag"];
    const title = match?.groups?.["title"];
    if (tag === undefined || title === undefined) return [];
    const ends = headings[index + 1]?.line ?? Number.MAX_SAFE_INTEGER;
    const prose = lines
      .filter((line) => line.number > heading.line && line.number < ends)
      .map((line) => line.text)
      .join("\n");
    return [{ file, tag, title, line: heading.line, prose }];
  });
};

const openerOf = (title: string): string => {
  const spoken = title
    .replaceAll("`", "")
    .split(/[\s,:;]+/)
    .filter((word) => word.length > 0);
  const first = spoken[0] ?? "";
  const verb = ADVERBS.has(first) ? (spoken[1] ?? "") : first;
  return verb.charAt(0).toUpperCase() + verb.slice(1);
};

const isImperative = (title: string): boolean => IMPERATIVES.has(openerOf(title));

const bannedIn = (file: string, lines: readonly Line[]): readonly string[] =>
  lines.flatMap((line) =>
    BANNED.flatMap(({ what, pattern }) =>
      [...line.text.matchAll(pattern)].map(
        (match) => `${file}:${line.number} names ${what} (${match[0]})`,
      ),
    ),
  );

const read = (file: string): string => readFileSync(path.join(repositoryRoot, file), "utf8");

const rulesFiles = (): readonly string[] =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => path.basename(file) === "CODING_RULES.md");

const everyRule = (): readonly Rule[] =>
  rulesFiles().flatMap((file) => rulesIn(file, withoutFences(read(file))));

// Spelled in two halves, so the tag scan does not read a fixture as a citation.
const spelled = (family: string, number: string): string => `[${family}${number}]`;

describe("the parser this form test reads a rules file with", () => {
  const FIXTURE = [
    "# Coding rules — a fixture",
    "",
    "## FAMILY",
    "",
    `### ${spelled("FIX", "1")} Write the expected value down`,
    "",
    "One two three.",
    "Reviewer: four five.",
    "",
    "```ts",
    "// six seven eight nine ten eleven, and T-001 on 2026-09-21 (ADR 0029)",
    "```",
    "",
    `### ${spelled("FIX", "2")} Deep modules at clean seams`,
    "",
    "Twelve T-002 thirteen.",
    "",
  ].join("\n");

  const lines = withoutFences(FIXTURE);

  it("reads a tagged heading as a rule and every other heading as none", () => {
    expect(rulesIn("fixture.md", lines).map((rule) => `${rule.tag} ${rule.title}`)).toEqual([
      "FIX1 Write the expected value down",
      "FIX2 Deep modules at clean seams",
    ]);
    expect(headingsIn(lines).map((heading) => heading.text)).toContain("FAMILY");
  });

  it("counts a rule's prose and leaves a fenced snippet out of the count", () => {
    const [first] = rulesIn("fixture.md", lines);
    expect(first).toBeDefined();
    expect(countWords(first?.prose ?? "")).toBe(6);
  });

  it("finds a banned reference in prose and none inside a fence", () => {
    expect(bannedIn("fixture.md", lines)).toEqual(["fixture.md:16 names a ticket id (T-002)"]);
  });

  it("reads an imperative opener, and an adverb before one, and refuses a noun phrase", () => {
    expect(isImperative("Write the expected value down")).toBe(true);
    expect(isImperative("Never mock our own code")).toBe(true);
    expect(isImperative("`Reviewer` lines")).toBe(false);
    expect(isImperative("Deep modules at clean seams")).toBe(false);
  });
});

describe("the form every coding rule is written in", () => {
  it("reads the five rules files the tree carries", () => {
    expect([...rulesFiles()].sort()).toEqual([
      "CODING_RULES.md",
      "apps/api/CODING_RULES.md",
      "apps/web/CODING_RULES.md",
      "apps/worker/CODING_RULES.md",
      "deploy/CODING_RULES.md",
    ]);
  });

  it("opens every rule with a tagged heading whose title is an imperative", () => {
    const wrong = everyRule()
      .filter((rule) => !isImperative(rule.title))
      .map((rule) => `${rule.file}:${rule.line} [${rule.tag}] ${rule.title}`);

    expect(
      wrong,
      "a rule's title is not an imperative a reader can obey. Open it with a verb; if the verb is new to this repository, add it to IMPERATIVES in the same commit.",
    ).toEqual([]);
  });

  it("heads every section with the file's title, a family word or a rule's tag", () => {
    const stray = rulesFiles().flatMap((file) =>
      headingsIn(withoutFences(read(file)))
        .filter(
          (heading) =>
            heading.level > 1 && !TAGGED.test(heading.text) && !FAMILY.test(heading.text),
        )
        .map((heading) => `${file}:${heading.line} ${heading.text}`),
    );

    expect(
      stray,
      "a heading in a rules file is neither a family word nor a rule's tag, so what sits under it is a rule a finding cannot cite.",
    ).toEqual([]);
  });

  it("names no ticket id, date or ADR number outside a snippet", () => {
    const named = rulesFiles().flatMap((file) => bannedIn(file, withoutFences(read(file))));

    expect(
      named,
      "a rules file carries a reference that ages: outside a snippet it names identifiers only. The ticket, the date and the decision are read in ordna, in git and in the decision record.",
    ).toEqual([]);
  });

  it(`holds every rule to ${RULE_BUDGET} words of prose, snippets free`, () => {
    const over = everyRule()
      .filter((rule) => !OVER_BUDGET.includes(rule.tag))
      .flatMap((rule) => {
        const count = countWords(rule.prose);
        return count > RULE_BUDGET ? [`${rule.file} [${rule.tag}] runs to ${count} words`] : [];
      });

    expect(
      over,
      `a rule runs past ${RULE_BUDGET} words. Cut what the gate already says, move a decision to the decision record and an enforcement gap to a ticket; the exception list is not for new entries.`,
    ).toEqual([]);
  });

  it(`holds ${ROOT_FILE} to ${ROOT_BUDGET} words of prose`, () => {
    const count = countWords(
      withoutFences(read(ROOT_FILE))
        .map((line) => line.text)
        .join("\n"),
    );

    expect(
      count,
      `${ROOT_FILE} runs to ${count} words. It is the constitution, read in full before work starts.`,
    ).toBeLessThanOrEqual(ROOT_BUDGET);
  });

  it("names a rule that is still over the budget in every entry of the exception list", () => {
    const rules = new Map(everyRule().map((rule) => [rule.tag, rule] as const));
    const spent = OVER_BUDGET.map((tag) => {
      const rule = rules.get(tag);
      if (rule === undefined) return `[${tag}] is no rule this tree defines`;
      const count = countWords(rule.prose);
      return count > RULE_BUDGET ? "" : `[${tag}] fits in ${count} words`;
    }).filter((finding) => finding.length > 0);

    expect(
      spent,
      "an entry of the exception list no longer earns its place. The list only shrinks: take the entry out in the commit that shortened its rule.",
    ).toEqual([]);
  });
});
