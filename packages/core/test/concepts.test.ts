import { testData } from "@better-answers/schema/testing";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { open } from "../src/answering/index.ts";
import {
  contentHashOf,
  conceptByIri,
  foldKind,
  parseConceptFile,
  renderConceptFile,
  writeConcept,
  type Frontmatter,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { FrontmatterValue, TrustStatus } from "../src/answering/index.ts";
import type { Result, UserPrincipal } from "../src/kernel/index.ts";
import { commit, head, PLATFORM_BOT, withRepositoryLock } from "@better-answers/core/store/git";
import { walkFrom } from "@better-answers/core/store/graph";
import {
  openPostgres,
  type Foldable,
  type Folded,
  type Tx,
  withMembership,
} from "../src/store/postgres/index.ts";
import {
  bundleHistory,
  bundlesForSuite,
  commitFacts,
  fileAtCommit,
  removeRepository,
} from "./bundle.ts";
import { bindingHolding } from "./sourced-concept.ts";
import {
  abortTheTransaction,
  answered,
  holdingTable,
  isBlockedOnTable,
  postgresForSuite,
  readingAs,
  until,
} from "./suite-postgres.ts";
import {
  arrangeWorkspace,
  doorsOf,
  memberOf,
  principalFor,
  type Scenario,
} from "./workspace-with-bundle.ts";

const db = postgresForSuite();
const bundles = bundlesForSuite();

const arrange = (): Promise<Scenario> => arrangeWorkspace(db(), bundles());

let minted = 0;

const iriFor = (): string => conceptIriOf(ulid());

const writeFor = (overrides: Partial<WriteConceptInput> = {}): WriteConceptInput => {
  minted += 1;
  return unnamedWrite(overrides);
};

const unnamedWrite = (overrides: Partial<WriteConceptInput>): WriteConceptInput => ({
  mergeKey: `policy:expenses-${minted}`,
  path: `knowledge/expenses-${minted}.md`,
  kind: "Policy",
  title: "Expenses",

  frontmatter: {
    title: "Expenses",
    type: "Policy",
    sources: [{ resource: "/sources/handbook.pdf", title: "Handbook", locator: "p.4" }],
  },
  body: "Expenses are claimed within thirty days.",
  message: "Record the expenses policy",
  author: { name: "Ada Editor", email: "ada@acme.invalid" },
  expects: { head: null },
  sensitivity: "Internal",
  ...overrides,
});

const rewriteOf = (
  input: WriteConceptInput,
  written: { readonly iri: string; readonly sha: string },
  overrides: Partial<WriteConceptInput> = {},
): WriteConceptInput => ({
  ...input,
  iri: written.iri,
  expects: { head: written.sha },
  ...overrides,
});

const write = (scenario: Scenario, principal: UserPrincipal, input: WriteConceptInput) =>
  writeConcept(principal, doorsOf(scenario), input);

const landed = async (scenario: Scenario, input: WriteConceptInput) => {
  const result = await write(scenario, scenario.editor, input);
  if (!result.ok) throw new Error(`the write was refused: ${String(result.error)}`);
  return result.value;
};

const rowsFor = async (workspaceId: string) => {
  const counted = await db().pool.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM concept_identity WHERE workspace_id = $1) AS identities,
            (SELECT count(*) FROM concept_index WHERE workspace_id = $1) AS concepts,
            (SELECT count(*) FROM bundle_commit WHERE workspace_id = $1) AS commits,
            (SELECT count(*) FROM evidence WHERE workspace_id = $1) AS evidence,
            (SELECT count(*) FROM audit_event WHERE workspace_id = $1) AS events,
            (SELECT count(*) FROM graph_node WHERE workspace_id = $1) AS nodes,
            (SELECT count(*) FROM graph_edge WHERE workspace_id = $1) AS edges`,
    [workspaceId],
  );
  return counted.rows[0];
};

const recordedCommits = async (workspaceId: string): Promise<readonly string[]> => {
  const rows = await db().pool.query<{ sha: string }>(
    "SELECT sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha",
    [workspaceId],
  );
  return rows.rows.map((row) => row.sha);
};

const reading = <T>(
  principal: UserPrincipal,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T>> => readingAs(db().runtimePool, principal, work);

describe("a governed write", () => {
  it("lands one commit authored by the person, bot as committer", async () => {
    const scenario = await arrange();
    const input = writeFor();

    const written = await landed(scenario, input);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, written.sha);
    expect({ subject: facts.subject, author: facts.author, committer: facts.committer }).toEqual({
      subject: "Record the expenses policy",
      author: "Ada Editor <ada@acme.invalid>",
      committer: `${PLATFORM_BOT.name} <${PLATFORM_BOT.email}>`,
    });
    expect(facts.parents).toEqual([]);
    expect(facts.files).toEqual([input.path]);
  });

  it("carries the actor and a pre-minted audit id as trailers", async () => {
    const scenario = await arrange();

    const written = await landed(scenario, writeFor());

    const facts = await commitFacts(scenario.git, scenario.workspaceId, written.sha);

    expect(facts.trailers).toEqual({
      Actor: `human:${scenario.editor.userId}`,
      Audit: written.auditEventId,
    });

    const joined = await db().pool.query<{ act: string; sha: string }>(
      `SELECT e.act, c.sha
         FROM audit_event e JOIN bundle_commit c
           ON c.workspace_id = e.workspace_id AND c.audit_event_id = e.id
        WHERE e.id = $1`,
      [written.auditEventId],
    );
    expect(joined.rows).toEqual([{ act: "knowledge.concept.committed", sha: written.sha }]);
  });

  it("writes the file with its frontmatter, body and own IRI", async () => {
    const scenario = await arrange();
    const input = writeFor();

    const written = await landed(scenario, input);

    const file = await fileAtCommit(scenario.git, scenario.workspaceId, written.sha, input.path);

    expect(file).toBe(
      [
        "---",
        '"title": "Expenses"',
        '"type": "Policy"',
        '"sources":',
        '  - "resource": "/sources/handbook.pdf"',
        '    "title": "Handbook"',
        '    "locator": "p.4"',
        `"iri": "${written.iri}"`,
        "---",
        "",
        "Expenses are claimed within thirty days.",
        "",
      ].join("\n"),
    );

    // Written down, never computed here: an expectation this act's own hash produced would
    // agree with any canonicalisation at all, the Python tier's included.
    expect(written.contentHash).toBe(
      "16f6c6993084b35862434bc90dece1fb2c2669cbddc21c910bdcd95bef0dcecc",
    );
  });

  it("hashes the frontmatter the file carries, as a parse reproduces", async () => {
    const scenario = await arrange();

    const input = writeFor({ frontmatter: { tags: ["finance"] } });

    const written = await landed(scenario, input);

    const file = await fileAtCommit(scenario.git, scenario.workspaceId, written.sha, input.path);
    const read = parseConceptFile(file);
    expect(read.ok && read.value.frontmatter).toMatchObject({
      type: "Policy",
      title: "Expenses",
      tags: ["finance"],
    });

    expect(read.ok && contentHashOf(read.value.frontmatter, read.value.body, input.path)).toBe(
      written.contentHash,
    );
    const row = await db().pool.query<{ content_hash: string }>(
      "SELECT content_hash FROM concept_index WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.iri],
    );
    expect(row.rows[0]?.content_hash).toBe(written.contentHash);
  });

  it("takes the file's status when the act names none", async () => {
    const scenario = await arrange();

    const input = writeFor({
      frontmatter: { title: "Expenses", type: "Policy", status: "stable" },
    });

    const written = await landed(scenario, input);

    const row = await db().pool.query<{ status: string; published: boolean }>(
      "SELECT status, published_at IS NOT NULL AS published FROM concept_index WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.iri],
    );
    expect(row.rows).toEqual([{ status: "stable", published: true }]);

    const file = await fileAtCommit(scenario.git, scenario.workspaceId, written.sha, input.path);
    expect(file).toContain('"status": "stable"');
  });

  it("records concept, identity, commit and evidence in one transaction", async () => {
    const scenario = await arrange();

    const handbook = await bindingHolding(db(), scenario.workspaceId);
    const input = writeFor({
      evidence: [
        {
          sourceDocumentId: handbook.documentId,
          locator: "p.4#para-2",
          resource: "Handbook (2026)",
        },
        { sourceDocumentId: handbook.documentId, locator: "p.9", resource: "Handbook (2026)" },
      ],
    });

    const written = await landed(scenario, input);

    expect(await rowsFor(scenario.workspaceId)).toEqual({
      identities: "1",
      concepts: "1",
      commits: "1",
      evidence: "2",

      events: "2",

      nodes: "1",
      edges: "0",
    });
    const row = await db().pool.query<Record<string, unknown>>(
      "SELECT iri, path, kind, title, content_hash, commit_sha, status, sensitivity, audience FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(row.rows).toEqual([
      {
        iri: written.iri,
        path: input.path,
        kind: "Policy",
        title: "Expenses",
        content_hash: written.contentHash,
        commit_sha: written.sha,
        status: "draft",
        sensitivity: "Internal",
        audience: "everyone",
      },
    ]);
  });

  it("keeps the version its evidence was recorded against", async () => {
    const scenario = await arrange();

    const handbook = await bindingHolding(db(), scenario.workspaceId);
    await landed(
      scenario,
      writeFor({
        evidence: [
          {
            sourceDocumentId: handbook.documentId,
            locator: "p.4",
            resource: "Handbook (2026)",
            contentVersion: "2026-03-01",
          },
        ],
      }),
    );

    const stored = await db().pool.query<{ content_version: string | null }>(
      "SELECT content_version FROM evidence WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(stored.rows).toEqual([{ content_version: "2026-03-01" }]);
  });

  it("folds the row's kind, leaving the file's spelling alone", async () => {
    const scenario = await arrange();

    let head: string | null = null;
    let firstFile: { readonly sha: string; readonly path: string } | undefined;
    for (const kind of ["policy", "Policies", "POLICY"]) {
      const base = writeFor({ kind, expects: { head } });
      const input = { ...base, frontmatter: { ...base.frontmatter, type: kind } };
      const written = await landed(scenario, input);
      head = written.sha;
      firstFile ??= { sha: written.sha, path: input.path };
    }

    const kinds = await db().pool.query<{ kind: string }>(
      "SELECT DISTINCT kind FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(kinds.rows).toEqual([{ kind: "Policy" }]);

    if (firstFile === undefined) return;
    const file = await fileAtCommit(
      scenario.git,
      scenario.workspaceId,
      firstFile.sha,
      firstFile.path,
    );
    expect(file).toContain('"type": "policy"');
  });

  it("hashes two spellings of one source alike, a swap differently", async () => {
    const body = "Expenses are claimed within thirty days.";
    const path = "knowledge/policies/expenses.md";
    const cite = (resource: string) => ({ sources: [{ resource, locator: "p.4" }] });

    const absolute = contentHashOf(cite("/knowledge/handbook.md"), body, path);
    const relative = contentHashOf(cite("./../handbook.md"), body, path);
    const bare = contentHashOf(cite("../handbook.md"), body, path);

    const dotted = contentHashOf(cite("/knowledge/policies/../handbook.md"), body, path);
    const swapped = contentHashOf(cite("/knowledge/other.md"), body, path);

    expect([relative, bare, dotted]).toEqual([absolute, absolute, absolute]);
    expect(swapped).not.toBe(absolute);

    expect(contentHashOf(cite("//knowledge/handbook.md"), body, path)).not.toBe(absolute);

    expect(contentHashOf(cite("  /knowledge/handbook.md  "), body, path)).toBe(absolute);
    expect(contentHashOf({ sources: ["  /knowledge/handbook.md  #p.4"] }, body, path)).toBe(
      absolute,
    );

    expect(
      contentHashOf(
        { sources: [{ resource: "/knowledge/handbook.md", locator: "p.4", title: "Fixed" }] },
        body,
        path,
      ),
    ).toBe(absolute);
  });

  it("keeps recorded commits a prefix of history across many acts", async () => {
    const scenario = await arrange();
    let head: string | null = null;
    const shas: string[] = [];
    for (const title of ["Expenses", "Travel", "Leave"]) {
      const written = await landed(scenario, writeFor({ title, expects: { head } }));
      shas.push(written.sha);
      head = written.sha;
    }

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(shas);
    expect(await recordedCommits(scenario.workspaceId)).toEqual(shas);
    const parents = await db().pool.query<{ sha: string; parent_sha: string | null }>(
      "SELECT sha, parent_sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha",
      [scenario.workspaceId],
    );
    expect(parents.rows.map((row) => row.parent_sha)).toEqual([null, shas[0], shas[1]]);
  });
});

describe("what a concept hashes and what it renders", () => {
  const HASHED_PATH = "knowledge/policies/expenses.md";

  it("hashes canonical JSON of all but trust keys and identity", () => {
    const frontmatter: Frontmatter = {
      title: "Expenses",
      type: "Policy",
      tags: ["travel", "receipts"],
      reviewers: [],
      usage_count: 4,
      approved: true,
      owner: null,

      sources: [
        { resource: "./handbook.md", title: "Handbook", locator: 4 },
        { resource: "/knowledge/policies/../rules.md", locator: null },
      ],
      generated: "2026-01-01",
      verified: "yes",
      stale_after: "3000-01-01",
      status: "stable",
      iri: "https://better-answers.com/c/01JZZZZZZZZZZZZZZZZZZZZZZZ",
    };

    const body = "First line   \r\nsecond line\t\r\n\r\n\r\n";

    expect(
      contentHashOf(
        {
          ...frontmatter,
          generated: "2027-06-30",
          verified: "no",
          stale_after: "2020-01-01",
          status: "draft",
          iri: "https://better-answers.com/c/01KAAAAAAAAAAAAAAAAAAAAAAA",
        },
        body,
        HASHED_PATH,
      ),
    ).toBe(contentHashOf(frontmatter, body, HASHED_PATH));
  });

  it("hashes a list of objects alike whatever its key order", () => {
    const body = "Expenses are claimed within thirty days.";

    const written = contentHashOf(
      {
        reviewers: [
          { name: "Ada", role: "finance" },
          { role: "legal", name: "Blake" },
        ],
      },
      body,
      HASHED_PATH,
    );
    const reordered = contentHashOf(
      {
        reviewers: [
          { role: "finance", name: "Ada" },
          { name: "Blake", role: "legal" },
        ],
      },
      body,
      HASHED_PATH,
    );
    const changed = contentHashOf(
      {
        reviewers: [
          { name: "Ada", role: "finance" },
          { role: "legal", name: "Casey" },
        ],
      },
      body,
      HASHED_PATH,
    );

    expect(reordered).toBe(written);
    expect(changed).not.toBe(written);
  });

  it("hashes a non-list `sources` or resourceless entry as citing nothing", () => {
    const body = "Expenses are claimed within thirty days.";

    expect(contentHashOf({ title: "Expenses", sources: "handbook.pdf" }, body, HASHED_PATH)).toBe(
      "71916fee7a5014777a4db734dffbe46b9c7f710bf699bb6092a15202953b78e5",
    );
    expect(
      contentHashOf(
        {
          sources: [{ note: "a comment, not a citation" }, { resource: "/knowledge/handbook.md" }],
        },
        body,
        HASHED_PATH,
      ),
    ).toBe("d135b04bcf88ef64e2dc07dbf14991ce75090677a2aada11804fa8014b7151e8");
  });

  it("renders keys quoted, empty lists inline, other lists over lines", () => {
    const file = renderConceptFile(
      {
        title: "Expenses",
        tags: ["travel", "receipts"],
        reviewers: [],
        usage_count: 4,
        approved: true,
        owner: null,
        sources: [
          { resource: "/sources/handbook.pdf", title: "Handbook", locator: "p.4" },
          { resource: "/sources/rules.pdf", locator: "p.9" },
        ],
      },
      "First line   \r\nsecond line\r\n\r\n",
    );

    expect(file).toBe(
      [
        "---",
        '"title": "Expenses"',
        '"tags":',
        '  - "travel"',
        '  - "receipts"',
        '"reviewers": []',
        '"usage_count": 4',
        '"approved": true',
        '"owner": null',
        '"sources":',
        '  - "resource": "/sources/handbook.pdf"',
        '    "title": "Handbook"',
        '    "locator": "p.4"',
        '  - "resource": "/sources/rules.pdf"',
        '    "locator": "p.9"',
        "---",
        "",
        "First line",
        "second line",
        "",
      ].join("\n"),
    );
  });

  it.each([
    ["policy", "Policy"],
    ["Policies", "Policy"],
    ["POLICY", "Policy"],
    ["Boxes", "Box"],
    ["Standards", "Standard"],
    ["Assessments", "Assessment"],

    ["Assessment", "Assessment"],
    ["Business", "Business"],
    ["Bonus", "Bonus"],
    ["Analysis", "Analysis"],
    ["Rate  card", "Rate  Card"],
  ])("folds the kind %s to %s", (kind, folded) => {
    expect(foldKind(kind)).toBe(folded);
  });
});

describe("the map a governed write leaves behind", () => {
  type Written = WriteConceptInput & { readonly iri: string };

  const linkedPair = async (
    scenario: Scenario,
    write: (product: Written, filename: string) => Partial<WriteConceptInput>,
  ) => {
    const input = writeFor({ kind: "Product", status: "stable" });
    const first = await landed(scenario, input);
    const product = { ...input, iri: first.iri };
    const policyInput = writeFor({
      status: "stable",
      expects: { head: first.sha },
      ...write(product, input.path.split("/").at(-1) ?? ""),
    });
    const second = await landed(scenario, policyInput);
    return { product, policy: { ...policyInput, iri: second.iri } };
  };

  it("maps the concept and its links in the committing transaction", async () => {
    const scenario = await arrange();
    const { product, policy } = await linkedPair(scenario, (_product, filename) => ({
      kind: "Policy",
      body: `# Details\n\nSee [the product](./${filename}) for tiers.`,
    }));

    const nodes = await db().pool.query(
      "SELECT uid, label, kind, gen, sensitivity, audience FROM graph_node WHERE workspace_id = $1 ORDER BY kind",
      [scenario.workspaceId],
    );
    expect(nodes.rows).toEqual([
      {
        uid: policy.iri,
        label: "Concept",
        kind: "Policy",
        gen: 1,
        sensitivity: "Internal",
        audience: "everyone",
      },
      {
        uid: product.iri,
        label: "Concept",
        kind: "Product",
        gen: 1,
        sensitivity: "Internal",
        audience: "everyone",
      },
    ]);

    const edges = await db().pool.query(
      "SELECT uid, label, from_uid, to_uid, from_kind, to_kind, section, sentence FROM graph_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([
      {
        uid: `links_to:${policy.iri}:0`,
        label: "LINKS_TO",
        from_uid: policy.iri,
        to_uid: product.iri,
        from_kind: "Policy",
        to_kind: "Product",
        section: "Details",
        sentence: "See the product for tiers.",
      },
    ]);

    const steps = answered(
      await reading(scenario.viewer, (principal, tx) => walkFrom(principal, tx, policy.iri)),
    );
    expect(steps.map((step) => ({ uid: step.uid, depth: step.depth }))).toEqual([
      { uid: policy.iri, depth: 0 },
      { uid: product.iri, depth: 1 },
    ]);
  });

  it("maps a link to not-yet-written knowledge when that knowledge lands", async () => {
    const scenario = await arrange();

    const author = writeFor({
      status: "stable",
      body: "See [travel](./travel.md) once it is written.",
    });
    const first = await landed(scenario, author);
    expect(await rowsFor(scenario.workspaceId)).toMatchObject({ edges: "0" });

    const travel = writeFor({
      kind: "Guideline",
      status: "stable",
      path: "knowledge/travel.md",
      expects: { head: first.sha },
    });
    const written = await landed(scenario, travel);

    const edges = await db().pool.query(
      "SELECT from_uid, to_uid, to_kind FROM graph_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([
      { from_uid: first.iri, to_uid: written.iri, to_kind: "Guideline" },
    ]);
  });

  it("reads inline, reference, shortcut and autolink markdown links alike", async () => {
    const scenario = await arrange();

    const { product, policy } = await linkedPair(scenario, (target, filename) => ({
      body: [
        "# Sources",
        "",
        `See [the product][target], [target] and <${target.iri}>.`,
        "",
        `[target]: ./${filename}`,
      ].join("\n"),
    }));

    const edges = await db().pool.query(
      "SELECT uid, to_uid, to_kind, section, sentence FROM graph_edge WHERE workspace_id = $1 ORDER BY uid",
      [scenario.workspaceId],
    );
    const sentence = `See the product, target and ${product.iri}.`;
    expect(edges.rows).toEqual([
      {
        uid: `links_to:${policy.iri}:0`,
        to_uid: product.iri,
        to_kind: "Product",
        section: "Sources",
        sentence,
      },
      {
        uid: `links_to:${policy.iri}:1`,
        to_uid: product.iri,
        to_kind: "Product",
        section: "Sources",
        sentence,
      },
      {
        uid: `links_to:${policy.iri}:2`,
        to_uid: product.iri,
        to_kind: "Product",
        section: "Sources",
        sentence,
      },
    ]);
  });

  it("keeps images, quoted code and protocol-relative targets off the map", async () => {
    const scenario = await arrange();

    const { product, policy } = await linkedPair(scenario, (_target, filename) => ({
      body: [
        "# Details",
        "",
        `![the product](./${filename}) shows the tiers; \`[a link](./${filename})\` is how one is written.`,
        "",
        "```md",
        `A fenced example: [the product](./${filename}).`,
        "`````",
        "",
        `Only [the product](./${filename}) itself maps.`,
        "",
        `A [protocol-relative](//knowledge/${filename}) target is external.`,
      ].join("\n"),
    }));

    const edges = await db().pool.query(
      "SELECT uid, to_uid, section, sentence FROM graph_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([
      {
        uid: `links_to:${policy.iri}:1`,
        to_uid: product.iri,
        section: "Details",
        sentence: "Only the product itself maps.",
      },
    ]);
  });

  it("keeps mapping links past long unmatched backtick runs", async () => {
    const scenario = await arrange();

    /**
     * The middle paragraph's size and shape are what a rescanning pairing chokes on: many
     * distinct unpaired lengths, then many paired short runs.
     */
    const { product, policy } = await linkedPair(scenario, (_target, filename) => ({
      body: [
        "# Details",
        "",
        `A crafted ${"`".repeat(2000)} run is literal text, not a span.`,
        "",
        `Then ${Array.from({ length: 60 }, (_, width) => "`".repeat(width + 3)).join(" x ")} never pair, while ${"`a` ".repeat(400)}all do.`,
        "",
        `And \`\`a span with \` inside\`\` still hides its code: [the product](./${filename}) maps.`,
      ].join("\n"),
    }));

    const edges = await db().pool.query(
      "SELECT uid, to_uid, sentence FROM graph_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([
      {
        uid: `links_to:${policy.iri}:0`,
        to_uid: product.iri,
        sentence: "And still hides its code: the product maps.",
      },
    ]);
  });

  it("backfills the map when an edit reaches a lost concept", async () => {
    const scenario = await arrange();
    const product = writeFor({ kind: "Product", status: "stable" });
    const first = await landed(scenario, product);
    const filename = product.path.split("/").at(-1) ?? "";
    const policy = writeFor({
      status: "stable",
      body: `See [the product](./${filename}) for tiers.`,
      expects: { head: first.sha },
    });
    const second = await landed(scenario, policy);

    await db().pool.query("DELETE FROM graph_edge WHERE workspace_id = $1", [scenario.workspaceId]);
    await db().pool.query("DELETE FROM graph_node WHERE workspace_id = $1", [scenario.workspaceId]);

    await landed(scenario, { ...product, iri: first.iri, expects: { head: second.sha } });

    const edges = await db().pool.query(
      "SELECT from_uid, to_uid FROM graph_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([{ from_uid: second.iri, to_uid: first.iri }]);
  });

  it("derives succession over a deprecated same-kind concept, else derivation", async () => {
    const scenario = await arrange();

    const superseded = writeFor({ status: "deprecated" });
    const first = await landed(scenario, superseded);
    const stillCurrent = writeFor({ status: "stable", expects: { head: first.sha } });
    const second = await landed(scenario, stillCurrent);

    const successor = writeFor({
      status: "stable",
      frontmatter: {
        title: "Expenses v2",
        type: "Policy",
        sources: [{ resource: first.iri }, { resource: second.iri }],
      },
      expects: { head: second.sha },
    });
    const third = await landed(scenario, successor);

    const edges = await db().pool.query(
      "SELECT uid, label, from_uid, to_uid, from_kind, to_kind, section, sentence FROM graph_edge WHERE workspace_id = $1 ORDER BY uid",
      [scenario.workspaceId],
    );

    expect(edges.rows).toEqual([
      {
        uid: `lineage:${third.iri}:0`,
        label: "SUPERSEDES",
        from_uid: third.iri,
        to_uid: first.iri,
        from_kind: null,
        to_kind: null,
        section: null,
        sentence: null,
      },
      {
        uid: `lineage:${third.iri}:1`,
        label: "DERIVED_FROM",
        from_uid: third.iri,
        to_uid: second.iri,
        from_kind: null,
        to_kind: null,
        section: null,
        sentence: null,
      },
    ]);
  });

  it("relabels a successor's lineage when its cited concept is deprecated", async () => {
    const scenario = await arrange();
    const cited = writeFor({ status: "stable" });
    const first = await landed(scenario, cited);
    const successor = writeFor({
      status: "stable",
      frontmatter: { title: "Expenses v2", type: "Policy", sources: [{ resource: first.iri }] },
      expects: { head: first.sha },
    });
    const second = await landed(scenario, successor);

    const lineageLabel = async (): Promise<readonly string[]> => {
      const rows = await db().pool.query<{ label: string }>(
        "SELECT label FROM graph_edge WHERE workspace_id = $1 AND from_uid = $2",
        [scenario.workspaceId, second.iri],
      );
      return rows.rows.map((row) => row.label);
    };

    expect(await lineageLabel()).toEqual(["DERIVED_FROM"]);

    await landed(
      scenario,
      writeFor({
        iri: first.iri,
        mergeKey: cited.mergeKey,
        path: cited.path,
        status: "deprecated",
        expects: { head: second.sha },
      }),
    );
    expect(await lineageLabel()).toEqual(["SUPERSEDES"]);
  });
});

describe("what a governed write refuses", () => {
  it("refuses a write against a moved head, without a commit", async () => {
    const scenario = await arrange();
    await landed(scenario, writeFor());

    const stale = await write(scenario, scenario.editor, writeFor({ expects: { head: null } }));

    expect(stale).toEqual({ ok: false, error: "stale-precondition" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await recordedCommits(scenario.workspaceId)).toHaveLength(1);
  });

  it("refuses a path another concept holds before committing anything", async () => {
    const scenario = await arrange();
    const first = writeFor();
    const written = await landed(scenario, first);
    const before = await rowsFor(scenario.workspaceId);

    const refused = await write(
      scenario,
      scenario.editor,
      writeFor({ path: first.path, expects: { head: written.sha } }),
    );

    expect(refused).toEqual({ ok: false, error: "path-taken" });
    expect(await head(scenario.editor, scenario.git)).toBe(written.sha);
    expect(await recordedCommits(scenario.workspaceId)).toEqual([written.sha]);
    expect(await rowsFor(scenario.workspaceId)).toEqual(before);
    const next = await landed(scenario, writeFor({ expects: { head: written.sha } }));
    expect(await recordedCommits(scenario.workspaceId)).toEqual([written.sha, next.sha]);
  });

  it("lets a concept be rewritten at its own path", async () => {
    const scenario = await arrange();
    const input = writeFor();
    const first = await landed(scenario, input);

    const rewritten = await write(
      scenario,
      scenario.editor,
      rewriteOf(input, first, { body: "Expenses are claimed within sixty days." }),
    );

    expect(rewritten.ok).toBe(true);
    expect(await recordedCommits(scenario.workspaceId)).toHaveLength(2);
  });

  it("refuses a Viewer before anything is committed", async () => {
    const scenario = await arrange();

    const refused = await write(scenario, scenario.viewer, writeFor());

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
    expect(await rowsFor(scenario.workspaceId)).toMatchObject({ concepts: "0", commits: "0" });
  });

  it("refuses a workspace with no bundle rather than making one", async () => {
    const scenario = await arrange();

    await removeRepository(scenario.git, scenario.workspaceId);

    const refused = await write(scenario, scenario.editor, writeFor());

    expect(refused).toEqual({ ok: false, error: "no-such-repository" });
  });

  it.each([
    ["outside the bundle's concept area", "elsewhere/expenses.md"],
    ["at the bundle's reserved manifest", "knowledge/manifest.yaml"],
    ["out of the tree altogether", "knowledge/../../escape.md"],
  ])("refuses a path %s without committing", async (_why, path) => {
    const scenario = await arrange();

    const refused = await write(scenario, scenario.editor, writeFor({ path }));

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
  });

  it("refuses a keyless entry in a list of objects", async () => {
    const scenario = await arrange();

    const refused = await write(
      scenario,
      scenario.editor,
      writeFor({ frontmatter: { title: "Expenses", type: "Policy", reviewers: [{}] } }),
    );

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
  });

  it("refuses a trailer value carrying a newline, whatever its type", async () => {
    const scenario = await arrange();

    const forged = await commit(scenario.editor, scenario.git, {
      path: "knowledge/expenses.md",
      content: "---\n---\n\nbody\n",
      message: "Record the expenses policy",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      trailers: { actor: `human:${scenario.editor.userId}`, audit: `${ulid()}\nRun: forged` },
      expectedHead: null,
      at: new Date(),
    });

    expect(forged).toEqual({ ok: false, error: "malformed-message" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
  });

  it.each([
    ["a merge key of no shape", { mergeKey: "   " }],
    [
      "an evidence locator of no shape",
      { evidence: [{ sourceDocumentId: ulid(), locator: "   ", resource: "Handbook" }] },
    ],
  ] satisfies readonly (readonly [string, Partial<WriteConceptInput>])[])(
    "refuses %s without committing",
    async (_why, invalid) => {
      const scenario = await arrange();

      const refused = await write(scenario, scenario.editor, writeFor(invalid));

      expect(refused).toEqual({ ok: false, error: "malformed" });
      expect(await head(scenario.editor, scenario.git)).toBeNull();
    },
  );

  it("hands back the store's own failure from its pre-commit read", async () => {
    const scenario = await arrange();
    const gone = new pg.Pool(db().runtimePool.options);
    await gone.end();

    const refused = await writeConcept(
      scenario.editor,
      { ...doorsOf(scenario), postgres: openPostgres(gone) },
      writeFor(),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBeInstanceOf(Error);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
  });

  it("refuses a newline in a message, blocking a forged trailer", async () => {
    const scenario = await arrange();

    const forged = await write(
      scenario,
      scenario.editor,
      writeFor({ message: `Record the policy\n\nAudit: ${ulid()}` }),
    );

    expect(forged).toEqual({ ok: false, error: "malformed-message" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
  });
});

describe("what a re-write of an existing concept may not move", () => {
  it("refuses widening an existing concept's class, and makes no commit", async () => {
    const scenario = await arrange();
    const input = writeFor({ sensitivity: "Restricted" });
    const first = await landed(scenario, input);

    const widened = await write(
      scenario,
      scenario.admin,
      rewriteOf(input, first, { sensitivity: "Public" }),
    );

    expect(widened).toEqual({ ok: false, error: "reclassification-refused" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    const held = await db().pool.query<{ sensitivity: string }>(
      "SELECT sensitivity FROM concept_index WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, first.iri],
    );
    expect(held.rows).toEqual([{ sensitivity: "Restricted" }]);
  });

  it("keeps an existing concept's class when the write names none", async () => {
    const scenario = await arrange();
    const input = writeFor({ sensitivity: "Internal" });
    const first = await landed(scenario, input);

    const { sensitivity: _named, ...unclassified } = rewriteOf(input, first);
    await landed(scenario, {
      ...unclassified,
      body: "Expenses are claimed within sixty days.",
    });

    const held = await db().pool.query<{ sensitivity: string }>(
      "SELECT sensitivity FROM concept_index WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, first.iri],
    );
    expect(held.rows).toEqual([{ sensitivity: "Internal" }]);
  });

  it("keeps an existing concept's status when the write names none", async () => {
    const scenario = await arrange();
    const input = writeFor({ status: "stable" });
    const first = await landed(scenario, input);

    const { status: _named, ...unstated } = rewriteOf(input, first);
    await landed(scenario, {
      ...unstated,
      body: "Expenses are claimed within sixty days.",
    });

    const held = await db().pool.query<{ status: string; published_at: Date | null }>(
      "SELECT status, published_at FROM concept_index WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, first.iri],
    );
    expect(held.rows[0]?.status).toBe("stable");
    expect(held.rows[0]?.published_at).toBeInstanceOf(Date);
  });

  it("stamps publishedAt with the platform's instant, not the transaction's", async () => {
    const scenario = await arrange();
    const input = writeFor({ status: "stable" });

    const pinned = new Date("2031-06-15T09:30:00.000Z");
    const written = await writeConcept(
      scenario.editor,
      { git: scenario.git, postgres: scenario.postgres, clock: { now: () => pinned } },
      input,
    );
    if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);

    const held = await db().pool.query<{ published_at: Date | null }>(
      "SELECT published_at FROM concept_index WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.value.iri],
    );
    expect(held.rows[0]?.published_at).toEqual(pinned);
  });

  it("refuses moving an existing concept to another path", async () => {
    const scenario = await arrange();
    const input = writeFor();
    const first = await landed(scenario, input);

    const moved = await write(
      scenario,
      scenario.editor,
      rewriteOf(input, first, { path: "knowledge/moved.md" }),
    );

    expect(moved).toEqual({ ok: false, error: "rename-refused" });

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });
});

/**
 * Bound here, never Postgres's now(): issuance is stamped by this process, and a second clock
 * would order events milliseconds apart by drift.
 */
const REVOCATIONS = {
  here: {
    statement:
      "UPDATE member SET credentials_revoked_at = $3 WHERE workspace_id = $1 AND user_id = $2",
    parameters: (scenario: Scenario, at: Date) => [
      scenario.workspaceId,
      scenario.editor.userId,
      at,
    ],
  },
  everywhere: {
    statement: 'UPDATE "user" SET credentials_revoked_at = $2 WHERE id = $1',
    parameters: (scenario: Scenario, at: Date) => [scenario.editor.userId, at],
  },
} as const;

type RevocationScope = keyof typeof REVOCATIONS;

const revoke = (
  client: { query: (statement: string, parameters: readonly unknown[]) => Promise<unknown> },
  scenario: Scenario,
  scope: RevocationScope,
): Promise<unknown> =>
  client.query(REVOCATIONS[scope].statement, REVOCATIONS[scope].parameters(scenario, new Date()));

const revokeEditor = (scenario: Scenario, scope: RevocationScope): Promise<unknown> =>
  revoke(db().pool, scenario, scope);

const backendPidOf = async (client: pg.PoolClient): Promise<number> => {
  const found = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = found.rows[0]?.pid;
  if (pid === undefined) throw new Error("the connection did not name its backend");
  return pid;
};

const isBlockedOnALock = async (pid: number): Promise<boolean> => {
  const found = await db().pool.query("SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted", [
    pid,
  ]);
  return (found.rowCount ?? 0) > 0;
};

const expectCommitsWithoutRows = async (scenario: Scenario, commits: number): Promise<void> => {
  expect(await rowsFor(scenario.workspaceId)).toMatchObject({ concepts: "0", commits: "0" });
  expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(commits);
};

describe("authority that moved while the act was in flight", () => {
  it("refuses a writer whose role moved, before any commit", async () => {
    const scenario = await arrange();

    await db().pool.query(
      "UPDATE member SET role = 'Viewer' WHERE workspace_id = $1 AND user_id = $2",
      [scenario.workspaceId, scenario.editor.userId],
    );

    const refused = await write(scenario, scenario.editor, writeFor());

    expect(refused).toEqual({ ok: false, error: "role-disagrees" });
    await expectCommitsWithoutRows(scenario, 0);
  });

  it.each(["here", "everywhere"] as const)(
    "refuses a writer with credentials revoked %s, before any commit",
    async (scope) => {
      const scenario = await arrange();
      await revokeEditor(scenario, scope);

      const refused = await write(scenario, scenario.editor, writeFor());

      expect(refused).toEqual({ ok: false, error: "credentials-revoked" });
      await expectCommitsWithoutRows(scenario, 0);
    },
  );

  it("lets a credential minted after a revocation write", async () => {
    const scenario = await arrange();

    await revokeEditor(scenario, "here");
    const afresh = await principalFor(db(), scenario.workspaceId, scenario.editor.userId);

    const written = await write(scenario, afresh, writeFor());

    expect(written.ok).toBe(true);
  });

  it("refuses a writer whose membership ended, before any commit", async () => {
    const scenario = await arrange();
    await db().pool.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      scenario.workspaceId,
      scenario.editor.userId,
    ]);

    const refused = await write(scenario, scenario.editor, writeFor());

    expect(refused).toEqual({ ok: false, error: "not-a-member" });
    await expectCommitsWithoutRows(scenario, 0);
  });

  it.each(["here", "everywhere"] as const)(
    "holds a revocation %s behind the act, then refuses writes",
    async (scope) => {
      const scenario = await arrange();

      const revoker = await db().pool.connect();
      let settled = false;
      let waiting: Promise<unknown> = Promise.resolve();
      try {
        const pid = await backendPidOf(revoker);
        await withMembership(scenario.editor, scenario.postgres, async () => {
          waiting = revoke(revoker, scenario, scope).then(() => {
            settled = true;
          });

          await until(() => isBlockedOnALock(pid));

          expect(settled).toBe(false);
        });

        await waiting;

        expect(settled).toBe(true);
      } finally {
        revoker.release();
      }

      const refused = await write(scenario, scenario.editor, writeFor());
      expect(refused).toEqual({ ok: false, error: "credentials-revoked" });
      await expectCommitsWithoutRows(scenario, 0);
    },
  );

  it("refuses the rows for a revocation the act cannot see", async () => {
    const scenario = await arrange();

    const revoker = await db().pool.connect();
    let acting: Promise<Result<unknown, unknown>> | undefined;
    let revoking: Promise<unknown> = Promise.resolve();
    try {
      await holdingTable(db().pool, "concept_index", async () => {
        acting = write(scenario, scenario.editor, writeFor());
        await until(() => isBlockedOnTable(db().pool, "concept_index"));

        const pid = await backendPidOf(revoker);
        revoking = revoke(revoker, scenario, "here");
        await until(() => isBlockedOnALock(pid));
      });
      await revoking;
    } finally {
      revoker.release();
    }

    const landed = await acting;

    expect(landed).toEqual({ ok: false, error: "credentials-revoked" });

    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(1);
    expect(await recordedCommits(scenario.workspaceId)).toEqual([]);
    expect(await rowsFor(scenario.workspaceId)).toMatchObject({
      concepts: "0",
      commits: "0",
      identities: "0",
    });
  });
});

describe("the read a concept's trust is derived from", () => {
  it("reads no check off a concept nobody has checked", async () => {
    const scenario = await arrange();
    const written = await landed(scenario, writeFor({ status: "stable" }));

    const opened = await reading(scenario.viewer, (principal, tx) =>
      conceptByIri(principal, tx, written.iri),
    );

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value?.check).toBeUndefined();
    expect(opened.value?.contentHash).toBe(written.contentHash);
  });

  it("hands a reader the store's failure, not an unminted concept", async () => {
    const scenario = await arrange();
    const written = await landed(scenario, writeFor({ status: "stable" }));
    let read: Result<unknown, unknown> | undefined;

    await expect(
      reading(scenario.viewer, async (principal, tx) => {
        await abortTheTransaction(tx);
        read = await conceptByIri(principal, tx, written.iri);
      }),
    ).rejects.toThrow(/did not commit/);

    expect(read).toEqual({ ok: false, error: expect.any(Error) });
  });
});

describe("a failure after the commit", () => {
  it("leaves no partial rows, and the head ahead of them", async () => {
    const scenario = await arrange();
    const first = writeFor();
    const written = await landed(scenario, first);
    const forged = await commit(scenario.editor, scenario.git, {
      path: first.path,
      content: renderConceptFile({ title: "Expenses", type: "Policy", iri: iriFor() }, first.body),
      message: "Record a second expenses policy by hand",
      author: first.author,
      trailers: { actor: `human:${scenario.editor.userId}`, audit: ulid() },
      expectedHead: written.sha,
      at: new Date(),
    });
    if (!forged.ok) throw new Error(`the forged commit was refused: ${String(forged.error)}`);
    const before = await rowsFor(scenario.workspaceId);

    const behind = await write(
      scenario,
      scenario.editor,
      writeFor({ expects: { head: forged.value.sha } }),
    );

    expect(await rowsFor(scenario.workspaceId)).toEqual(before);

    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    const recorded = await recordedCommits(scenario.workspaceId);
    expect(history).toHaveLength(3);
    expect(recorded).toEqual([history[0]]);
    expect(await head(scenario.editor, scenario.git)).toBe(history[2]);
    expect(behind).toEqual({ ok: false, error: expect.any(Error) });
  });
});

describe("the per-repository lock", () => {
  it("serialises acts per bundle but not across bundles", async () => {
    const door = bundles();
    const here = await arrange();
    const there = await arrange();
    const order: string[] = [];
    const held = async (principal: UserPrincipal, name: string): Promise<void> =>
      withRepositoryLock(principal, door, async () => {
        order.push(`${name} in`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`${name} out`);
      });

    await Promise.all([
      held(here.editor, "first"),
      held(here.viewer, "second"),
      held(there.editor, "elsewhere"),
    ]);

    const sameBundle = order.filter((step) => !step.startsWith("elsewhere"));
    expect(sameBundle).toEqual(["first in", "first out", "second in", "second out"]);
    expect(order).toContain("elsewhere out");
  });

  it("leaves one commit when two writes race one head", async () => {
    const scenario = await arrange();

    const [first, second] = await Promise.all([
      write(scenario, scenario.editor, writeFor()),
      write(scenario, scenario.editor, writeFor()),
    ]);

    expect([first.ok, second.ok].toSorted()).toEqual([false, true]);
    const refused = first.ok === false ? first : second;
    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(1);
    expect(await recordedCommits(scenario.workspaceId)).toEqual(history);
  });

  it("releases the bundle when an act fails inside the lock", async () => {
    const scenario = await arrange();
    await landed(scenario, writeFor());

    /**
     * A failure the act meets inside the lock; one decided before the lock is taken would
     * prove nothing about releasing it.
     */
    const failed = await write(scenario, scenario.editor, writeFor({ expects: { head: null } }));
    expect(failed).toEqual({ ok: false, error: "stale-precondition" });

    const head = await bundleHistory(scenario.git, scenario.workspaceId);
    const next = await landed(scenario, writeFor({ expects: { head: head[0] ?? null } }));

    expect(next.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("opening a concept by IRI", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("hands back the committed concept, unchecked until somebody checks it", async () => {
    const scenario = await arrange();
    const input = writeFor({ status: "stable" });
    const written = await landed(scenario, input);

    const opened = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, now),
    );

    expect(opened.ok).toBe(true);
    if (!opened.ok || !opened.value.found) return;
    expect(opened.value.concept).toEqual({
      iri: written.iri,

      frontmatter: { ...input.frontmatter, status: "stable", iri: written.iri },
      body: input.body,
      relations: [],
      trust: {
        tier: "unverified",
        status: "current",
        checkedBy: null,
        checkedAt: null,
        rider: null,
      },
      evidence: [{ locator: "p.4", source: "Handbook" }],
    });
  });

  it("withholds a draft concept from every reader, whatever their role", async () => {
    const scenario = await arrange();

    const input = writeFor({ status: "draft" });
    const written = await landed(scenario, input);

    const seen = await Promise.all(
      [scenario.viewer, scenario.editor, scenario.admin].map((principal) =>
        reading(principal, (resolved, tx) => open(resolved, tx, { iri: written.iri }, now)),
      ),
    );

    expect(seen.map((result) => result.ok && result.value.found)).toEqual([false, false, false]);
    const stored = await db().pool.query<{ published_at: Date | null }>(
      "SELECT published_at FROM concept_index WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.iri],
    );
    expect(stored.rows).toEqual([{ published_at: null }]);
  });

  it("reads a person's check, and says when the content moved", async () => {
    const scenario = await arrange();
    const input = writeFor({ status: "stable" });
    const written = await landed(scenario, input);
    const client = await db().pool.connect();
    try {
      await testData(client).conceptVerification({
        workspaceId: scenario.workspaceId,
        iri: written.iri,
        actor: `human:${scenario.admin.userId}`,
        contentHash: written.contentHash,
      });
    } finally {
      client.release();
    }

    const checked = await reading(scenario.viewer, (principal, tx) =>
      conceptByIri(principal, tx, written.iri),
    );
    expect(checked).toMatchObject({ ok: true });
    const opened = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, now),
    );
    expect(opened.ok && opened.value.found && opened.value.concept?.trust).toMatchObject({
      tier: "human-reviewed",
      status: "current",
      checkedBy: "Test person",
    });

    await landed(
      scenario,
      rewriteOf(input, written, { body: "Expenses are claimed within sixty days." }),
    );
    const moved = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, now),
    );
    expect(moved.ok && moved.value.found && moved.value.concept?.trust.status).toBe(
      "changed-since-checked",
    );
  });

  it("names the checking member, or their id once they leave", async () => {
    const scenario = await arrange();
    const written = await landed(scenario, writeFor({ status: "stable" }));
    const priya = await memberOf(db().pool, scenario.workspaceId, "priya.anand@acme.invalid");
    const client = await db().pool.connect();
    try {
      await testData(client).conceptVerification({
        workspaceId: scenario.workspaceId,
        iri: written.iri,
        actor: `human:${priya.id}`,
        contentHash: written.contentHash,
      });
    } finally {
      client.release();
    }
    const checkedBy = async () => {
      const opened = await reading(scenario.viewer, (principal, tx) =>
        open(principal, tx, { iri: written.iri }, now),
      );
      return opened.ok && opened.value.found ? opened.value.concept?.trust.checkedBy : undefined;
    };

    expect(await checkedBy()).toBe("Priya Anand");

    await db().pool.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      scenario.workspaceId,
      priya.id,
    ]);

    expect(await checkedBy()).toBe(`human:${priya.id}`);
  });

  it("shows a deprecated concept to every reader as deprecated", async () => {
    const scenario = await arrange();

    const written = await landed(scenario, writeFor({ status: "deprecated" }));

    const opened = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, now),
    );

    expect(opened.ok && opened.value.found && opened.value.concept?.trust.status).toBe(
      "deprecated",
    );
  });

  it("names a platform check by its process and its rider", async () => {
    const scenario = await arrange();
    const written = await landed(scenario, writeFor({ status: "stable" }));
    const client = await db().pool.connect();
    try {
      await testData(client).conceptVerification({
        workspaceId: scenario.workspaceId,
        iri: written.iri,
        actor: "process:better-answers-importer",
        origin: "imported",
        contentHash: null,
        checkedAt: new Date("2026-03-03T09:00:00.000Z"),
      });
    } finally {
      client.release();
    }

    const opened = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, now),
    );

    expect(opened.ok && opened.value.found && opened.value.concept?.trust).toEqual({
      tier: "machine-confirmed",
      status: "current",
      checkedBy: "process:better-answers-importer",
      checkedAt: "2026-03-03T09:00:00.000Z",
      rider: "imported",
    });
  });

  it("shows each cited source by its recognisable name, or none", async () => {
    const scenario = await arrange();
    const citing = await landed(
      scenario,
      writeFor({
        status: "stable",
        frontmatter: {
          title: "Expenses",
          type: "Policy",
          sources: [
            { resource: "/sources/handbook.pdf", title: "Handbook", locator: "p.4" },

            { resource: "/sources/travel.pdf", title: "", locator: "p.9" },
            { resource: "/sources/rates.csv" },
          ],
        },
      }),
    );
    const bare = await landed(
      scenario,
      writeFor({
        status: "stable",
        frontmatter: { title: "Travel", type: "Policy" },
        expects: { head: citing.sha },
      }),
    );

    const [cited, uncited] = await Promise.all([
      reading(scenario.viewer, (principal, tx) => open(principal, tx, { iri: citing.iri }, now)),
      reading(scenario.viewer, (principal, tx) => open(principal, tx, { iri: bare.iri }, now)),
    ]);

    expect(cited.ok && cited.value.found && cited.value.concept?.evidence).toEqual([
      { locator: "p.4", source: "Handbook" },
      { locator: "p.9", source: "/sources/travel.pdf" },
      { locator: "", source: "/sources/rates.csv" },
    ]);
    expect(uncited.ok && uncited.value.found && uncited.value.concept?.evidence).toEqual([]);
  });

  const SHELF_LIVES: readonly (readonly [string, FrontmatterValue | undefined, TrustStatus])[] = [
    ["no shelf life at all", undefined, "current"],
    ["a date long past", "2020-01-01", "out-of-date"],

    ["the Clock's day, which it lasts through", "2026-09-08", "current"],
    ["a date far ahead", "3000-01-01", "current"],
    ["an offset datetime long past", "2020-01-01T00:00:00Z", "out-of-date"],
    ["an offset datetime far ahead", "3000-01-01T00:00:00+01:00", "current"],

    ["an explicit offset long past", "2020-01-01T00:00:00+01:00", "out-of-date"],
    ["fractions of a second long past", "2020-01-01T00:00:00.123Z", "out-of-date"],

    ["an impossible calendar day", "2026-02-30", "current"],

    ["an impossible calendar day with an offset", "2026-02-30T00:00:00Z", "current"],
    ["a month the calendar has not got", "2020-13-01", "current"],
    ["a datetime with no offset", "2020-01-01T00:00:00", "current"],
    ["a two-digit year `Date` would remap", "0020-01-01", "out-of-date"],
    ["something that is not a date", "when the contract ends", "current"],

    ["a past date behind a prefix", "not-a-date2020-01-01", "current"],

    ["a list where a date belongs", ["2020-01-01"], "current"],
  ];

  it.each(SHELF_LIVES)("reads %s as %s", async (_why, staleAfter, expected) => {
    const scenario = await arrange();
    const input = writeFor({
      status: "stable",
      frontmatter: {
        title: "Expenses",
        type: "Policy",
        ...(staleAfter === undefined ? {} : { stale_after: staleAfter }),
      },
    });
    const written = await landed(scenario, input);

    const read = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, now),
    );

    expect(read.ok && read.value.found && read.value.concept?.trust.status).toBe(expected);
  });

  it("expires at the end of a date-only shelf life's day", async () => {
    const scenario = await arrange();
    const written = await landed(
      scenario,
      writeFor({
        status: "stable",
        frontmatter: { title: "Expenses", type: "Policy", stale_after: "2026-03-01" },
      }),
    );

    const boundary = new Date("2026-03-02T00:00:00.000Z");
    const atTheBoundary = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, boundary),
    );
    const aMillisecondBefore = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, new Date(boundary.getTime() - 1)),
    );

    expect(
      atTheBoundary.ok && atTheBoundary.value.found && atTheBoundary.value.concept?.trust.status,
    ).toBe("out-of-date");
    expect(
      aMillisecondBefore.ok &&
        aMillisecondBefore.value.found &&
        aMillisecondBefore.value.concept?.trust.status,
    ).toBe("current");
  });

  it("is current at an offset-datetime shelf life's exact instant", async () => {
    const scenario = await arrange();
    const written = await landed(
      scenario,
      writeFor({
        status: "stable",
        frontmatter: { title: "Expenses", type: "Policy", stale_after: "2026-03-01T12:00:00Z" },
      }),
    );

    const instant = new Date("2026-03-01T12:00:00.000Z");
    const atTheInstant = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, instant),
    );
    const aMillisecondAfter = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, new Date(instant.getTime() + 1)),
    );

    expect(
      atTheInstant.ok && atTheInstant.value.found && atTheInstant.value.concept?.trust.status,
    ).toBe("current");
    expect(
      aMillisecondAfter.ok &&
        aMillisecondAfter.value.found &&
        aMillisecondAfter.value.concept?.trust.status,
    ).toBe("out-of-date");
  });

  it("withholds a Restricted concept from a Viewer as if unminted", async () => {
    const scenario = await arrange();
    const input = writeFor({ sensitivity: "Restricted", status: "stable" });
    const written = await landed(scenario, input);

    const unminted = iriFor();
    const withheld = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, now),
    );
    const absent = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: unminted }, now),
    );

    expect(withheld).toEqual({ ok: true, value: { found: false, iri: written.iri } });
    expect(absent).toEqual({ ok: true, value: { found: false, iri: unminted } });

    const seen = await reading(scenario.admin, (principal, tx) =>
      open(principal, tx, { iri: written.iri }, now),
    );
    expect(seen.ok && seen.value.found).toBe(true);
  });

  it("never reaches another workspace's concept, whoever asks", async () => {
    const here = await arrange();
    const there = await arrange();
    const written = await landed(there, writeFor());

    const reached: Result<unknown, unknown> = await reading(here.admin, (principal, tx) =>
      conceptByIri(principal, tx, written.iri),
    );

    expect(reached).toEqual({ ok: true, value: undefined });
  });
});
