import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const RULE_TAG = /\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/g;

const RULE_HEADING = /^#{2,3}\s+\[(?<tag>[A-Z][A-Z0-9]*[A-Z][0-9]+)\]/gm;

const NOT_TEXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|sqlite)$/i;

const OUTSIDE = [".scratch/", ".cubic/"];

const isLink = (file: string): boolean =>
  lstatSync(path.join(repositoryRoot, file)).isSymbolicLink();

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

const isTest = (file: string): boolean =>
  /(^|\/)(tests?|e2e)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

const isDocument = (file: string): boolean =>
  file === "CONTEXT.md" ||
  (file.endsWith(".md") && file.startsWith("docs/")) ||
  /(^|\/)(readme\.md|SKILL\.md|THIRD_PARTY_NOTICES\.md)$/i.test(file);

const GATES_PRINTING_A_TAG = new Set([
  "packages/devtools/python/comment_gate.py",
  "packages/devtools/src/comment-density.ts",
]);

const isAllowedLocation = (file: string): boolean =>
  isRulesFile(file) ||
  GATES_PRINTING_A_TAG.has(file) ||
  file.startsWith("docs/adr/") ||
  file.startsWith("docs/specs/") ||
  file === "cubic.yaml" ||
  file === ".oxlintrc.json" ||
  file.startsWith("packages/devtools/lint-rules/") ||
  isTest(file) ||
  isDocument(file);

const CITED_NOWHERE_ELSE: Readonly<Record<string, string>> = {
  APP1: "the tier runs from source or it does not start: Node resolves the `.ts` extension every intra-repository import carries, and the workspace's own package.json and tsconfig are what declare it, where a tag may not be written",
  AUDIT6:
    "the migration that creates audit_event and its refusal tests are the schema package's; they hold the rule without naming the tag",
  AUDIT7: "the caller-minted id test is its slice's, and holds the rule without naming the tag",
  WEB5: "the failed-screen component test and its browser spec hold the rule — the frame, its landmarks and the way out survive a screen that throws — and they hold it without naming the tag",
};

type Citation = { readonly file: string; readonly line: number; readonly tag: string };

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
  "apps/worker/tests/test_config.py",
  "apps/worker/tests/test_document_chunk_contract.py",
  "apps/worker/tests/test_image.py",
  "apps/worker/tests/test_links.py",
  "apps/worker/tests/test_log_bridge.py",
  "apps/worker/tests/test_monkeypatch_guard.py",
  "apps/worker/tests/test_pipeline_host.py",
  "apps/worker/tests/test_pipeline_index.py",
  "apps/worker/tests/test_pipeline_landed.py",
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
  "packages/core/test/contract-fixture.ts",
  "packages/core/test/document-chunk.contract.test.ts",
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
  "packages/core/test/passages.test.ts",
  "packages/core/test/principal.test.ts",
  "packages/core/test/queue.contract.test.ts",
  "packages/core/test/reconciler.test.ts",
  "packages/core/test/redaction.contract.test.ts",
  "packages/core/test/runs.test.ts",
  "packages/core/test/sources.test.ts",
  "packages/core/test/suggestions.test.ts",
  "packages/core/test/suite-postgres.ts",
  "packages/core/test/visibility-columns.contract.test.ts",
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
  "packages/schema/test/chunk-columns.test.ts",
  "packages/schema/test/factory.ts",
  "packages/schema/test/harness.ts",
  "packages/schema/test/job-kinds.test.ts",
  "packages/schema/test/llm-route-scenario.ts",
  "packages/schema/test/migration-ownership.test.ts",
  "packages/schema/test/rls.test.ts",
  "packages/schema/test/source-catalogue.test.ts",
  "packages/schema/test/table-ownership.test.ts",
  "packages/schema/test/testing.ts",
  "packages/schema/test/warm-postgres.test.ts",
  "packages/schema/test/warm-postgres.ts",
  "packages/schema/test/worker-schema-view.test.ts",
];

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

    expect(
      citations.filter(({ tag }) => !defined.has(tag)).map(cite),
      "a tag is cited that no rules file defines. Either the rule was retired — then the citation is rewritten in words pointing at the ADR that records the retirement — or the heading in the rules file lost its tag.",
    ).toEqual([]);

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
