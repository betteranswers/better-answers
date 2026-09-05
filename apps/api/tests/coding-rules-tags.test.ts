import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A rule tag — `[SEC2]`, `[APP4]` — is a pointer into a rules file, and `[COMMENT2]` says
 * where one may be written: where rules are made, kept, reviewed or proved, and in a
 * document a reader follows to the rule — never in source, a deploy file, a Dockerfile or
 * a CI workflow, where a comment carries its reason in words or is deleted.
 *
 * Two things went wrong before this test. Three rules were retired from the constitution
 * on 2026-08-31 and their tags dangled in eleven files for five days, because nothing read
 * a citation against the list of rules that exist. And a hundred citations grew in source
 * comments, most of them an agent following the previous comment's shape, because nothing
 * said where a tag belongs. This is both promises as a check, held both ways (`[TEST7]`):
 *
 * - every tag cited anywhere in the tree is defined in a rules file, and sits where
 *   `[COMMENT2]` allows — one direction finds the retired tag, the other the tag that has
 *   crept back into source;
 * - every defined tag is cited at least once outside its own file, or is listed below with
 *   the reason it is not — so a rule nobody points at is a decision, never an accident,
 *   and a listed reason that has stopped being true is caught the day a citation lands.
 *
 * **What it can and cannot see.** A tag is the bracketed form; a rule named in words
 * ("the identity seam, ADR 0009") is a pointer this test does not follow, which is the
 * point — words do not dangle. `.scratch/` and `.cubic/` are working material and a
 * generated wiki, outside the check by the ticket's decision. A tag inside a string the
 * code prints is a citation like any other, because the reader sees it the same way.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

/**
 * A rule tag: a family of at least two capitals (digits allowed inside — `A11Y`), then the
 * rule's number. One letter and a number — `[S11]`, a research note's source footnote — is
 * not one; `T-003` carries a hyphen and is not one; `[TEST]` has no number and is a family,
 * the form `cubic.yaml` lists.
 */
const RULE_TAG = /\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/g;
/** A rule's heading in a rules file — `### [SEC2] …` at the root, `## [APP1] …` in a tier file. */
const RULE_HEADING = /^#{2,3}\s+\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/gm;

/** Files whose bytes are not prose; nothing in them is a citation a reader sees. */
const NOT_TEXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|sqlite)$/i;
/** Outside the check by decision: working material, and a generated wiki that only orients. */
const OUTSIDE = [".scratch/", ".cubic/"];

/**
 * Every file the repository tracks or would track — `--others --exclude-standard` reads a
 * new file before it is added and skips what `.gitignore` refuses, so the check sees the
 * tree a commit would carry and nothing a machine left behind.
 */
const treeFiles = (): readonly string[] =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => !OUTSIDE.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !NOT_TEXT.test(file));

const read = (file: string): string => readFileSync(path.join(repositoryRoot, file), "utf8");

const isRulesFile = (file: string): boolean => path.basename(file) === "CODING_RULES.md";

/** A test, or what a suite is built from: a `test`, `tests` or `e2e` directory, or a test file by name. */
const isTest = (file: string): boolean =>
  /(^|\/)(tests?|e2e)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

/**
 * A document a reader follows to the rule, as `[COMMENT2]` lists them: the glossary, a note
 * under `docs/` or `apps/docs-site/` (research, operations, the gate record), a package's
 * readme, a notices file. Not every markdown file — a `.md` beside source is source's.
 */
const isDocument = (file: string): boolean =>
  file === "CONTEXT.md" ||
  (file.endsWith(".md") && (file.startsWith("docs/") || file.startsWith("apps/docs-site/"))) ||
  /(^|\/)(readme\.md|THIRD_PARTY_NOTICES\.md)$/i.test(file);

/**
 * Where `[COMMENT2]` lets a tag be written. The rules files, ADRs, specs and `cubic.yaml`
 * are where rules are made and reviewed against; the lint config and the plugin rules are
 * where one is enforced, so a rule's message may name it; a test is where one is proved; a
 * document is what a reader follows to the rule. Everything else — source, deploy files,
 * Dockerfiles, CI workflows, a workspace's config — is code, and code carries its reason
 * in words.
 */
const isAllowedLocation = (file: string): boolean =>
  isRulesFile(file) ||
  file.startsWith("docs/adr/") ||
  file.startsWith("apps/docs-site/specs/") ||
  file === "cubic.yaml" ||
  file === ".oxlintrc.json" ||
  file.startsWith("apps/api/tools/lint-rules/") ||
  isTest(file) ||
  isDocument(file);

/**
 * Defined tags that no file outside their own rules file names, each with the reason. A
 * tag here that gains a citation is a stale entry and fails the test; a tag missing from
 * here that has no citation fails it too — the list is exact in both directions.
 */
const CITED_NOWHERE_ELSE: Readonly<Record<string, string>> = {
  APP2: "one server, one logger, one config module is the tier's shape; a reviewer reads it off the tree, and no test or ADR needs to name it",
  AUDIT1:
    "the ledger is T-059's; its slice tests cite the rule when they land, and until then it binds review alone",
  AUDIT2: "as AUDIT1 — the declared-acts walk that proves it is T-059's",
  AUDIT3: "as AUDIT1 — the ActorId type and its test are T-059's",
  AUDIT4: "as AUDIT1 — the second door's type and the access-request test are T-059's",
  AUDIT5: "as AUDIT1 — each declared act's detail type is its slice's",
  AUDIT6: "as AUDIT1 — the migration that creates audit_event and its refusal tests are T-059's",
  AUDIT7: "as AUDIT1 — the caller-minted id test is T-059's",
  AUDIT8: "as AUDIT1 — held by the declared-acts walk, T-059's",
  WRK2: "one logger, one config module is the worker's shape; a reviewer reads it off the tree, and no test or ADR needs to name it",
};

type Citation = { readonly file: string; readonly line: number; readonly tag: string };

const citationsIn = (file: string): readonly Citation[] =>
  read(file)
    .split("\n")
    .flatMap((text, index) =>
      [...text.matchAll(RULE_TAG)].flatMap((match) => {
        const tag = match.groups?.["tag"];
        return tag === undefined ? [] : [{ file, line: index + 1, tag }];
      }),
    );

/** Every defined tag, and the rules file that defines it. */
const definedTags = (): ReadonlyMap<string, string> =>
  new Map(
    treeFiles()
      .filter(isRulesFile)
      .flatMap((file) =>
        [...read(file).matchAll(RULE_HEADING)].flatMap((match) => {
          const tag = match.groups?.["tag"];
          return tag === undefined ? [] : [[tag, file] as const];
        }),
      ),
  );

const cite = ({ file, line, tag }: Citation): string => `${file}:${line} cites [${tag}]`;

describe("rule tags against the rules files that define them (T-078)", () => {
  it("defines every tag the tree cites, and cites each one only where a rule may be cited", () => {
    const defined = definedTags();
    const citations = treeFiles().flatMap(citationsIn);

    // The first direction finds the retired tag: a citation of a rule no file defines.
    expect(
      citations.filter(({ tag }) => !defined.has(tag)).map(cite),
      "a tag is cited that no rules file defines. Either the rule was retired — then the citation is rewritten in words pointing at the ADR that records the retirement — or the heading in the rules file lost its tag.",
    ).toEqual([]);

    // The second finds the tag that crept back into code: a citation outside the places
    // `[COMMENT2]` names. The fix is the comment's own test under `[COMMENT1]` — keep the
    // constraint in words, or delete the comment — never the tag re-spelled as a sentence.
    expect(
      citations.filter(({ file }) => !isAllowedLocation(file)).map(cite),
      "a rule tag is cited in source, a deploy file, a Dockerfile, a CI workflow or a workspace's config. [COMMENT2]: write the constraint in words or delete the comment; the tag stays in the rules files, ADRs, specs, cubic.yaml, the lint config, the tests and the documents.",
    ).toEqual([]);
  });

  it("finds every defined tag cited outside its own file, or listed with the reason it is not", () => {
    const defined = definedTags();
    const citedElsewhere = new Set(
      treeFiles()
        .flatMap(citationsIn)
        .filter(({ file, tag }) => defined.get(tag) !== file)
        .map(({ tag }) => tag),
    );

    const uncited = [...defined.keys()].filter((tag) => !citedElsewhere.has(tag)).sort();
    const listed = Object.keys(CITED_NOWHERE_ELSE).sort();

    // [TEST7] both ways: a defined tag nobody cites and nobody listed is a rule that may
    // have stopped meaning anything; a listed tag that is now cited is a reason that has
    // stopped being true, and the entry leaves with the citation that made it so.
    expect(
      uncited.filter((tag) => !listed.includes(tag)),
      "a defined tag is cited nowhere outside its own rules file. Cite it where it is applied — a test, an ADR, a spec, cubic.yaml — or add it to CITED_NOWHERE_ELSE with the reason it is judged in review alone.",
    ).toEqual([]);
    expect(
      listed.filter((tag) => !uncited.includes(tag)),
      "a tag listed in CITED_NOWHERE_ELSE is now cited outside its own file. Remove the entry: the reason it carried has stopped being true.",
    ).toEqual([]);
  });

  it("reads tags from every rules file, and the tags it reads look like tags", () => {
    // The assertions above go quiet when nothing matches: no rules files found is no tags
    // defined is nothing to check. Three rules files exist today and each defines a tag.
    const defined = definedTags();
    const files = new Set(defined.values());

    expect(files).toContain("CODING_RULES.md");
    expect(files).toContain("apps/api/CODING_RULES.md");
    expect(files).toContain("apps/worker/CODING_RULES.md");
    expect([...defined.keys()].every((tag) => /^[A-Z][A-Z0-9]*[A-Z][0-9]+$/.test(tag))).toBe(true);
  });
});
