import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 *   and a listed reason that has stopped being true is caught the day a citation lands;
 * - every test that cites a tag is one `TESTS_CITING_A_TAG` froze, and every file that list
 *   names still cites one. `[COMMENT2]` stopped admitting a test on 2026-09-11 (`ed6b8c6`)
 *   and 105 tests still carried a tag that morning, so the rule is met by a ratchet rather
 *   than by one pass: the list only shrinks, and the day it empties `isTest` leaves
 *   `isAllowedLocation` with it (T-182).
 *
 * **What it can and cannot see.** A tag is the bracketed form; a rule named in words
 * ("the identity seam, ADR 0009") is a pointer this test does not follow, which is the
 * point — words do not dangle. `.scratch/` and `.cubic/` are working material and a
 * generated wiki, outside the check by the ticket's decision. A tag inside a string the
 * code prints is a citation like any other, because the reader sees it the same way. A tag
 * struck in an ADR's body — `~~…~~`, the index's convention for a sentence an amendment
 * superseded — is history the ADR is bound to keep, not a citation, and is not read.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

/**
 * A rule tag: a family of at least two capitals (digits allowed inside — `A11Y`), then the
 * rule's number. One letter and a number — `[S11]`, a research note's source footnote — is
 * not one; `T-003` carries a hyphen and is not one; `[TEST]` has no number and is a family,
 * the form `cubic.yaml` lists.
 */
const RULE_TAG = /\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/g;
/**
 * A rule's heading in a rules file — `### [SEC2] …` at the root, the same line with two
 * hashes in a tier file.
 *
 * The tier's example used to spell the api workspace's first tag, and it was struck on
 * 2026-09-12 because an illustration of a heading's *form* is not a citation of the rule:
 * nothing here sends a reader to "the tier runs from source", and this line was that tag's
 * only appearance outside its own rules file. It is listed in `CITED_NOWHERE_ELSE` below
 * instead, with the reason — and named in words here, because a rule named in words is the
 * pointer this file's own header says does not dangle (T-182).
 */
const RULE_HEADING = /^#{2,3}\s+\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/gm;

/** Files whose bytes are not prose; nothing in them is a citation a reader sees. */
const NOT_TEXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|sqlite)$/i;
/** Outside the check by decision: working material, and a generated wiki that only orients. */
const OUTSIDE = [".scratch/", ".cubic/"];

/**
 * A tracked symlink is a path and not prose — git keeps the target it names — and whatever it
 * points at is walked on its own account when the tree tracks that too. Reading one would
 * follow it to a directory and fail (`.claude/skills/better-answers-design` is the design
 * system's package, linked where a session finds it, T-081).
 */
const isLink = (file: string): boolean =>
  lstatSync(path.join(repositoryRoot, file)).isSymbolicLink();

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
    .filter((file) => !NOT_TEXT.test(file))
    .filter((file) => !isLink(file));

const read = (file: string): string => readFileSync(path.join(repositoryRoot, file), "utf8");

const isRulesFile = (file: string): boolean => path.basename(file) === "CODING_RULES.md";

/** A test, or what a suite is built from: a `test`, `tests` or `e2e` directory, or a test file by name. */
const isTest = (file: string): boolean =>
  /(^|\/)(tests?|e2e)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

/**
 * A document a reader follows to the rule, as `[COMMENT2]` lists them: the glossary, a note
 * under `docs/` (research, operations, the gate record), a package's readme, a notices file.
 * Not every markdown file — a `.md` beside source is source's.
 *
 * A tracked `SKILL.md` is one of them, added by T-071: a skill this repository writes and
 * carries is read by the next session exactly the way a note under `docs/` is, and a tag in
 * it is the pointer that sends that session to the rule. Only a tracked one — the installed
 * third-party skills under `.claude/skills/` are `.gitignore`d and never reach this walk.
 */
const isDocument = (file: string): boolean =>
  file === "CONTEXT.md" ||
  (file.endsWith(".md") && file.startsWith("docs/")) ||
  /(^|\/)(readme\.md|SKILL\.md|THIRD_PARTY_NOTICES\.md)$/i.test(file);

/**
 * Where `[COMMENT2]` lets a tag be written. The rules files, ADRs, specs and `cubic.yaml`
 * are where rules are made and reviewed against; the lint config and the plugin rules are
 * where one is enforced, so a rule's message may name it; a document is what a reader
 * follows to the rule. Everything else — source, deploy files, Dockerfiles, CI workflows, a
 * workspace's config — is code, and code carries its reason in words.
 *
 * `isTest` is here because the tree has not caught up, not because `[COMMENT2]` allows it:
 * the rule stopped admitting a test on 2026-09-11 and 105 of them still cited a tag. What
 * holds that line is `TESTS_CITING_A_TAG` below, which admits those files and no others and
 * only shrinks; when it empties, this clause goes with it (T-182).
 */
const isAllowedLocation = (file: string): boolean =>
  isRulesFile(file) ||
  file.startsWith("docs/adr/") ||
  file.startsWith("docs/specs/") ||
  file === "cubic.yaml" ||
  file === ".oxlintrc.json" ||
  file.startsWith("packages/devtools/lint-rules/") ||
  isTest(file) ||
  isDocument(file);

/**
 * Defined tags that no file outside their own rules file names, each with the reason. A
 * tag here that gains a citation is a stale entry and fails the test; a tag missing from
 * here that has no citation fails it too — the list is exact in both directions.
 */
const CITED_NOWHERE_ELSE: Readonly<Record<string, string>> = {
  APP1: "the tier runs from source or it does not start: Node resolves the `.ts` extension every intra-repository import carries, and the workspace's own package.json and tsconfig are what declare it, where a tag may not be written",
  AUDIT6:
    "the migration that creates audit_event and its refusal tests are the schema package's; they hold the rule without naming the tag",
  AUDIT7: "the caller-minted id test is its slice's, and holds the rule without naming the tag",
  AUDIT8:
    "the declared-acts walk refuses an act whose subject names one of these records, and holds the rule without naming the tag",
  WEB5: "the failed-screen component test and its browser spec hold the rule — the frame, its landmarks and the way out survive a screen that throws — and they hold it without naming the tag",
  WRK2: "one logger, one config module is the worker's shape; a reviewer reads it off the tree, and no test or ADR needs to name it",
  WRK4: "mypy strict over src and tests, and ruff's ANN rules, hold it on every run; what enforces it is the workspace's own configuration, where a tag may not be written",
};

type Citation = { readonly file: string; readonly line: number; readonly tag: string };

/** In an ADR, a struck span is a sentence an amendment superseded; what it cites was retired with it. */
const STRUCK = /~~[^~\n]+~~/g;

const citationsIn = (file: string): readonly Citation[] =>
  read(file)
    .split("\n")
    .map((text) => (file.startsWith("docs/adr/") ? text.replace(STRUCK, "") : text))
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

/**
 * The tests that cite a rule tag, frozen on 2026-09-12 at 105 of the 146 files `isTest`
 * calls a test, of the 638 this walk considers. `[COMMENT2]` stopped admitting a test the
 * day before and the tree did not empty itself, so this list is the ratchet between the
 * rule and the tree: a citation in a test outside it is refused, an entry whose file has
 * stopped citing one is refused too, and the list only ever shrinks. A ticket that takes a
 * tag out of one of these files takes its entry with it, in the same commit.
 *
 * Generated, never typed — from the repository root, and the output pasted whole:
 *
 *     git ls-files --cached --others --exclude-standard \
 *       | grep -E '(^|/)(tests?|e2e)/|\.(test|spec)\.[cm]?[jt]sx?$' \
 *       | grep -vE '^(\.scratch|\.cubic)/' \
 *       | xargs grep -lIE '\[[A-Z][A-Z0-9]*[A-Z][0-9]+\]' \
 *       | LC_ALL=C sort | sed 's|.*|  "&",|'
 *
 * That pipeline is `treeFiles`, `isTest` and `citationsIn` written in shell. Where the two
 * ever disagree the test below is the arbiter, because it runs the real walk.
 */
const TESTS_CITING_A_TAG: readonly string[] = [
  "apps/api/tests/adr-index.test.ts",
  "apps/api/tests/auth-instance.ts",
  "apps/api/tests/backup-image.test.ts",
  "apps/api/tests/better-auth-endpoints.test.ts",
  "apps/api/tests/check-scripts.test.ts",
  "apps/api/tests/cimd-fetch.test.ts",
  "apps/api/tests/coding-rules-tags.test.ts",
  "apps/api/tests/config.test.ts",
  "apps/api/tests/delete-user.test.ts",
  "apps/api/tests/deploy-tree.test.ts",
  "apps/api/tests/harness-control.ts",
  "apps/api/tests/harness.ts",
  "apps/api/tests/hostnames.test.ts",
  "apps/api/tests/image-job.test.ts",
  "apps/api/tests/image.test.ts",
  "apps/api/tests/invitation-shape.test.ts",
  "apps/api/tests/lefthook-config.test.ts",
  "apps/api/tests/lint-rules.test.ts",
  "apps/api/tests/local.ts",
  "apps/api/tests/no-ambient-clock.test.ts",
  "apps/api/tests/oauth-flow.test.ts",
  "apps/api/tests/ops.test.ts",
  "apps/api/tests/postgres.ts",
  "apps/api/tests/provision-skills.test.ts",
  "apps/api/tests/provision-worktree.test.ts",
  "apps/api/tests/routes-list.test.ts",
  "apps/api/tests/serve.ts",
  "apps/api/tests/workflow-pins.test.ts",
  "apps/api/tests/workflow-tools.test.ts",
  "apps/web/e2e/accessibility-gate.spec.ts",
  "apps/web/e2e/browser.ts",
  "apps/web/e2e/frame.spec.ts",
  "apps/web/e2e/harness.ts",
  "apps/web/e2e/routes.spec.ts",
  "apps/web/e2e/sign-in.spec.ts",
  "apps/web/test/api-client.test.tsx",
  "apps/web/test/browser-suite-skill.test.ts",
  "apps/web/test/failed-screen.test.tsx",
  "apps/web/test/folder-case.test.ts",
  "apps/web/test/frame.test.tsx",
  "apps/web/test/lint-rules.test.ts",
  "apps/web/test/playwright-config.test.ts",
  "apps/worker/tests/bundles.py",
  "apps/worker/tests/conftest.py",
  "apps/worker/tests/factories.py",
  "apps/worker/tests/pg_harness.py",
  "apps/worker/tests/test_cocoindex_ban.py",
  "apps/worker/tests/test_concept_file.py",
  "apps/worker/tests/test_image.py",
  "apps/worker/tests/test_links.py",
  "apps/worker/tests/test_monkeypatch_guard.py",
  "apps/worker/tests/test_pytest_options.py",
  "apps/worker/tests/test_redaction.py",
  "apps/worker/tests/test_redaction_contract.py",
  "apps/worker/tests/test_redaction_descriptors.py",
  "apps/worker/tests/test_redaction_weights.py",
  "apps/worker/tests/test_work_loop.py",
  "packages/core/test/access-requests.test.ts",
  "packages/core/test/answering.test.ts",
  "packages/core/test/audit.test.ts",
  "packages/core/test/bundle-root.test.ts",
  "packages/core/test/bundle.ts",
  "packages/core/test/concepts.test.ts",
  "packages/core/test/dpia.test.ts",
  "packages/core/test/erasure-map.test.ts",
  "packages/core/test/erasure-rehearsal.test.ts",
  "packages/core/test/erasure-replay.test.ts",
  "packages/core/test/erasure-routine.test.ts",
  "packages/core/test/erasure.test.ts",
  "packages/core/test/findings.test.ts",
  "packages/core/test/git.test.ts",
  "packages/core/test/graph-ops.test.ts",
  "packages/core/test/graph.test.ts",
  "packages/core/test/import-direction.test.ts",
  "packages/core/test/invisibility.test.ts",
  "packages/core/test/kernel.test.ts",
  "packages/core/test/llm-routes.test.ts",
  "packages/core/test/members.test.ts",
  "packages/core/test/principal.test.ts",
  "packages/core/test/reconciler.test.ts",
  "packages/core/test/redaction.contract.test.ts",
  "packages/core/test/runs.test.ts",
  "packages/core/test/suggestions.test.ts",
  "packages/core/test/suite-postgres.ts",
  "packages/core/test/visibility.test.ts",
  "packages/core/test/worker-process.ts",
  "packages/core/test/workspace-with-bundle.ts",
  "packages/core/test/workspaces.test.ts",
  "packages/devtools/test/jscpd.test.ts",
  "packages/devtools/test/knip.test.ts",
  "packages/devtools/test/mutant-probe.test.ts",
  "packages/devtools/test/mutation-summary.test.ts",
  "packages/devtools/test/throwaway-tree.test.ts",
  "packages/devtools/test/vitest-runner-patch.test.ts",
  "packages/schema/test/boundary-schemas.test.ts",
  "packages/schema/test/factory.ts",
  "packages/schema/test/harness.ts",
  "packages/schema/test/llm-route-scenario.ts",
  "packages/schema/test/migration-ownership.test.ts",
  "packages/schema/test/rls.test.ts",
  "packages/schema/test/table-ownership.test.ts",
  "packages/schema/test/testing.ts",
  "packages/schema/test/warm-postgres.test.ts",
  "packages/schema/test/warm-postgres.ts",
  "packages/schema/test/worker-schema-view.test.ts",
];

/**
 * The baseline read against the tree both ways (`[TEST7]`): what cites a tag and is not
 * listed, and what is listed and has stopped. It takes the baseline as a parameter so the
 * two cases below can prove each direction against a file they write themselves — one
 * direction finds the citation that landed after the freeze, the other the entry that
 * outlived the tag it was written for.
 */
const baselineDrift = (
  baseline: readonly string[],
): { readonly unlisted: readonly string[]; readonly stale: readonly string[] } => {
  const citing = new Set(
    treeFiles()
      .filter(isTest)
      .filter((file) => citationsIn(file).length > 0),
  );
  const listed = new Set(baseline);
  return {
    unlisted: [...citing].filter((file) => !listed.has(file)).sort(),
    stale: baseline.filter((file) => !citing.has(file)).sort(),
  };
};

/**
 * Runs `read` while one untracked test file holds `contents`, and removes it whatever the
 * assertion did. The walk reads `git ls-files --others`, so a file written inside the
 * repository is seen exactly as a committed one is — which is what makes this a proof — and
 * the `finally` is what keeps the next suite in the same run from reading it as a citation
 * of its own.
 */
const whileATestFileHolds = <T>(contents: string, read: () => T): T => {
  const proof = path.join(repositoryRoot, "apps/api/tests/tag-baseline-proof.txt");
  writeFileSync(proof, contents);
  try {
    return read();
  } finally {
    rmSync(proof, { force: true });
  }
};

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
      "a rule tag is cited in source, a deploy file, a Dockerfile, a CI workflow or a workspace's config. [COMMENT2]: write the constraint in words or delete the comment; the tag stays in the rules files, ADRs, specs, cubic.yaml, the lint config and the documents, and in a test only while TESTS_CITING_A_TAG still lists that file.",
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
    // defined is nothing to check. Four rules files exist today and each defines a tag.
    const defined = definedTags();
    const files = new Set(defined.values());

    expect(files).toContain("CODING_RULES.md");
    expect(files).toContain("apps/api/CODING_RULES.md");
    expect(files).toContain("apps/web/CODING_RULES.md");
    expect(files).toContain("apps/worker/CODING_RULES.md");
    expect([...defined.keys()].every((tag) => /^[A-Z][A-Z0-9]*[A-Z][0-9]+$/.test(tag))).toBe(true);
  });
});

describe("the tests that still cite a rule tag, held to a baseline that only shrinks (T-182)", () => {
  it("admits a citation in the tests frozen on 2026-09-12 and in no other", () => {
    const { unlisted, stale } = baselineDrift(TESTS_CITING_A_TAG);

    // [TEST7] both ways: one direction finds the tag written into a test after the rule
    // stopped admitting one, the other the entry left behind by a tag that has gone.
    expect(
      unlisted,
      "a test cites a rule tag and TESTS_CITING_A_TAG does not list it. [COMMENT2]: a test says what it holds in words, in its docblock — the constraint, the trade-off, the rule's own sentence — never the tag. The baseline is a ratchet and only shrinks, so it is never widened to admit a new citation.",
    ).toEqual([]);
    expect(
      stale,
      "a file TESTS_CITING_A_TAG lists no longer cites a rule tag. Remove its entry in the commit that took the last tag out: the list is exact both ways, so a stale entry is a place the next citation could land unseen.",
    ).toEqual([]);
  });

  it("refuses a tag written into a test after the baseline was frozen", () => {
    const unlisted = whileATestFileHolds(
      "A test that cites [TEST7] rather than saying what it holds in words.\n",
      () => baselineDrift(TESTS_CITING_A_TAG).unlisted,
    );

    expect(unlisted).toEqual(["apps/api/tests/tag-baseline-proof.txt"]);
  });

  it("refuses a baseline entry whose test has stopped citing a tag", () => {
    const stale = whileATestFileHolds(
      "A test that says in words what it holds, and names no tag.\n",
      () => baselineDrift([...TESTS_CITING_A_TAG, "apps/api/tests/tag-baseline-proof.txt"]).stale,
    );

    expect(stale).toEqual(["apps/api/tests/tag-baseline-proof.txt"]);
  });
});
