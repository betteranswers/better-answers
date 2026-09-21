import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const RULE_TAG = /\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/g;
const RULE_HEADING = /^#{2,3}\s+\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/gm;

const NOT_TEXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|sqlite)$/i;
const OUTSIDE = [".scratch/", ".cubic/"];

// Reading a tracked symlink would follow it to a directory and throw; whatever it points at
// is walked on its own account.
const isLink = (file: string): boolean =>
  lstatSync(path.join(repositoryRoot, file)).isSymbolicLink();

// `--others --exclude-standard` sees a new file before it is added, so the walk reads the
// tree a commit would carry.
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

// Each of these prints the rule it holds in the message a reader hits, so the reader reaches
// the rule without asking.
const GATES_PRINTING_A_TAG: readonly string[] = [
  "apps/worker/tests/conftest.py",
  "packages/devtools/lint-rules/rules/comment-only-the-why.ts",
  "packages/devtools/lint-rules/rules/import-direction.ts",
  "packages/devtools/lint-rules/rules/mcp-entry-no-workspace-argument.ts",
  "packages/devtools/python/comment_gate.py",
  "packages/devtools/src/comment-density.ts",
];

// Only files that carry one, so the list holds no slot a later citation could land in.
const FROZEN: readonly string[] = [
  "docs/adr/0004-guides-and-compositions-are-platform-records.md",
  "docs/adr/0005-own-app-two-tiers-parts-lifted-by-contract.md",
  "docs/adr/0007-plain-postgres-and-app-owned-migrations.md",
  "docs/adr/0008-trpc-inside-openapi-and-mcp-outside.md",
  "docs/adr/0009-better-auth-in-process-identity-provider.md",
  "docs/adr/0010-typed-relations-on-concepts.md",
  "docs/adr/0011-knowledge-layers-and-the-minting-rule.md",
  "docs/adr/0012-the-concept-write-path.md",
  "docs/adr/0013-sources-bound-by-origin-reach-and-destination.md",
  "docs/adr/0015-a-composition-cites-its-concept-by-a-footnote-labelled-by-the-include.md",
  "docs/adr/0016-an-answer-asserts-concepts-only-found-by-traversal-and-served-as-one-contract.md",
  "docs/adr/0017-every-answer-is-a-retained-correctable-record-and-an-answer-is-minted-only-at-a-gate-a-person-runs.md",
  "docs/adr/0018-one-mcp-surface-of-five-entries-the-principal-from-the-token-grown-by-scope.md",
  "docs/adr/0019-trust-is-derived-from-the-file-told-in-fixed-words-and-moved-only-by-a-check.md",
  "docs/adr/0020-personal-data-is-withheld-at-the-seam-before-any-store-and-erased-from-every-copy-by-routine.md",
  "docs/adr/0021-the-graph-is-neo4j-community-on-one-instance-tenanted-by-rule-written-in-generations-and-never-a-hard-dependency.md",
  "docs/adr/0022-two-stacks-deployed-by-digest-every-irreplaceable-byte-encrypted-off-host-erasures-replayed-on-restore.md",
  "docs/adr/0023-the-graph-is-apache-age-inside-the-platform-postgres.md",
  "docs/adr/0025-a-signal-is-a-query-over-rows-the-platform-already-keeps.md",
  "docs/adr/0026-kinds-emerge-from-the-concepts-no-vocabulary-file-a-link-is-the-relation.md",
  "docs/adr/0027-better-answers-is-open-core-under-apache-2-0-the-hosted-service-is-the-product-copyleft-is-run-only.md",
  "docs/adr/0028-a-boundary-schema-is-generated-from-its-table-a-refinement-only-narrows-and-a-parity-test-proves-it.md",
  "docs/adr/0029-the-tier-is-apps-over-packages-business-logic-is-a-library-of-capability-slices-over-four-store-doors.md",
  "docs/adr/0030-the-mcp-surface-stays-mcp-sdk-v2-in-the-typescript-tier-behind-one-fetch-shaped-seam.md",
  "docs/adr/0031-the-tier-contract-is-six-agreements-in-three-forms-fixtured-in-one-language-neutral-directory-both-suites-read.md",
  "docs/adr/0032-the-graph-is-plain-tables-under-rls-the-substrate-is-one-journal-one-role-seam-one-definer-function.md",
  "docs/adr/0033-the-ui-kit-is-tailwind-v4-through-the-design-system-bridge-with-three-registries-that-own-behaviour.md",
  "docs/adr/0034-one-origin-for-the-product-and-the-authorization-server.md",
  "docs/adr/0035-a-person-has-one-id-minted-by-the-platform-revoked-in-two-scopes-and-erased-to-a-per-workspace-pseudonym.md",
  "docs/adr/0036-the-worker-composes-cocoindexs-building-blocks-and-writes-only-what-the-engine-has-no-block-for.md",
  "docs/adr/0037-a-reader-facing-screen-has-a-latency-budget-lists-under-a-second-actions-under-100-ms-optimistically-answers-streamed.md",
  "docs/adr/0040-the-clock-is-a-kernel-value-the-api-constructs-once-at-boot-and-hands-to-every-act-that-reads-time-a-rows-own-timestamp-stays-the-databases-now-and-the-worker-is-handed-no-clock.md",
  "docs/adr/0041-a-secret-belongs-to-one-of-seven-credential-classes-the-bootstrap-class-comes-from-the-deploy-unit-and-the-other-six-are-rows-under-the-envelope.md",
  "docs/adr/0042-the-product-ships-an-accessibility-statement-because-the-buyers-are-uk-public-bodies-for-whom-it-is-law.md",
  "docs/adr/0043-an-act-is-what-an-entry-may-ask-core-to-do-admitted-before-its-body-runs-refusing-in-classed-words-that-cross-every-transport-as-themselves-in-a-transaction-only-its-opener-rolls-back.md",
  "docs/adr/README.md",
  "docs/specs/T-004.md",
  "docs/specs/T-006.md",
  "docs/specs/T-015.md",
  "docs/specs/T-022.md",
  "docs/specs/T-045.md",
  "docs/specs/T-048.md",
  "docs/specs/T-063.md",
  "docs/specs/T-064.md",
  "docs/specs/T-120.md",
  "docs/specs/T-121.md",
  "docs/specs/T-122.md",
  "docs/specs/T-123.md",
  "docs/specs/T-124.md",
  "docs/specs/T-125.md",
  "docs/specs/T-126.md",
  "docs/specs/T-127.md",
  "docs/specs/T-128.md",
  "docs/specs/T-129.md",
  "docs/specs/T-131.md",
  "docs/specs/T-133.md",
  "docs/specs/T-168.md",
  "docs/specs/coding-rules-one-form-and-the-comment-strip.md",
  "docs/specs/s0-redaction-seam-and-erasure.md",
  "docs/specs/s1-acts-ahead-of-the-first-procedures.md",
  "docs/specs/s1-one-uploaded-document-to-a-cited-passage.md",
  "docs/specs/v01-route.md",
];

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

const isAllowedLocation = (file: string): boolean =>
  isRulesFile(file) || GATES_PRINTING_A_TAG.includes(file) || FROZEN.includes(file);

// The walk reads `git ls-files --others`, so a written file is seen as a committed one; the
// `finally` keeps the next suite from reading it.
const whileAFileNamed = <T>(relative: string, contents: string, taken: () => T): T => {
  const written = path.join(repositoryRoot, relative);
  writeFileSync(written, contents);
  try {
    return taken();
  } finally {
    rmSync(written, { force: true });
  }
};

const whileAFileHolds = <T>(contents: string, taken: () => T): T =>
  whileAFileNamed("apps/api/tests/tag-location-proof.txt", contents, taken);

const whileARulesFileHolds = <T>(contents: string, taken: () => T): T =>
  whileAFileNamed("apps/api/tests/CODING_RULES.md", contents, taken);

describe("where a rule tag may be written", () => {
  it("finds one only in a rules file, a gate's failure message, or a frozen document", () => {
    const stray = treeFiles()
      .filter((file) => !isAllowedLocation(file))
      .flatMap(citationsIn);

    expect(
      stray.map(cite),
      "a rule tag is written outside the three places one belongs. Write the rule in words where the reader meets it, or delete the sentence; never swap the tag for a restatement of the rule's own wording.",
    ).toEqual([]);
  });

  it("refuses a tag written into a file the tree has just gained", () => {
    const [aDefinedTag] = [...definedTags().keys()];
    expect(aDefinedTag).toBeDefined();
    const strayFiles = (): readonly string[] =>
      treeFiles()
        .filter((file) => !isAllowedLocation(file))
        .flatMap(citationsIn)
        .map(({ file }) => file);

    const before = new Set(strayFiles());
    const after = whileAFileHolds(
      `A note that cites [${aDefinedTag}] rather than the rule.\n`,
      strayFiles,
    );

    expect([...new Set(after)].filter((file) => !before.has(file))).toEqual([
      "apps/api/tests/tag-location-proof.txt",
    ]);
  });
});

describe("the tags a gate prints and the rules files that define them", () => {
  it("defines every tag a gate's failure message names", () => {
    const defined = definedTags();
    const printed = GATES_PRINTING_A_TAG.flatMap(citationsIn);

    expect(printed.length).toBeGreaterThan(0);
    expect(
      printed.filter(({ tag }) => !defined.has(tag)).map(cite),
      "a gate prints a tag no rules file defines. Either the rule was retired and the message is rewritten in words, or the heading in the rules file lost its tag.",
    ).toEqual([]);
  });

  it("defines every tag a rules file cites in another rule's body", () => {
    const defined = definedTags();
    const cited = treeFiles().filter(isRulesFile).flatMap(citationsIn);

    expect(
      cited.filter(({ tag }) => !defined.has(tag)).map(cite),
      "a rules file points at a rule no rules file defines. The rule was retired: say in words what the sentence needs, or delete the cross-reference with it.",
    ).toEqual([]);
  });

  it("reads tags from every rules file", () => {
    const files = new Set(definedTags().values());

    expect(files).toContain("CODING_RULES.md");
    expect(files).toContain("apps/api/CODING_RULES.md");
    expect(files).toContain("apps/web/CODING_RULES.md");
    expect(files).toContain("apps/worker/CODING_RULES.md");
  });

  it("reads a well-formed heading as a definition and a malformed one as none", () => {
    const heading = (tag: string, title: string): string => `## [${tag}] ${title}\n\n`;
    const before = new Set(definedTags().keys());
    const after = whileARulesFileHolds(
      heading("PROBE1", "A family of two capitals, then a number") +
        heading("Probe2", "Lower case inside the family") +
        heading("PROBE", "No number") +
        heading("P1", "One letter"),
      () => new Set(definedTags().keys()),
    );

    expect([...after].filter((tag) => !before.has(tag))).toEqual(["PROBE1"]);
  });
});

const PROOF = "apps/api/tests/tag-location-proof.txt";

const citingNothing = (list: readonly string[]): readonly string[] =>
  list.filter((file) => citationsIn(file).length === 0);

describe("the two lists this walk reads a file past", () => {
  const listed = [...FROZEN, ...GATES_PRINTING_A_TAG];

  it("names a file the tree still carries in every entry of both", () => {
    const tracked = new Set(treeFiles());

    expect(
      listed.filter((file) => !tracked.has(file)),
      "a listed file is gone from the tree. Both lists only shrink, so an entry leaves with the file it named; a stale one is where the next citation could land unseen.",
    ).toEqual([]);
  });

  it("names a file that still cites a tag in every entry of both", () => {
    expect(
      citingNothing(listed),
      "a listed file cites no tag any more. Remove its entry in the commit that took the last one out: an entry whose file carries none is a slot the next citation lands in unseen.",
    ).toEqual([]);
  });

  it("refuses an entry whose file has shed its last tag", () => {
    const shed = whileAFileHolds("A document that names its rule in words.\n", () =>
      citingNothing([...listed, PROOF]),
    );

    expect(shed).toEqual([PROOF]);
  });
});
