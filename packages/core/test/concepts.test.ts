import { testData } from "@better-answers/schema/testing";
import type pg from "pg";
import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { open } from "../src/answering/index.ts";
import {
  contentHashOf,
  conceptByIri,
  writeConcept,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { TrustStatus } from "../src/answering/index.ts";
import type { Result, UserPrincipal } from "../src/kernel/index.ts";
import { commit, head, PLATFORM_BOT, withRepositoryLock } from "@better-answers/core/store/git";
import { walkFrom } from "@better-answers/core/store/graph";
import { type Tx, withMembership } from "../src/store/postgres/index.ts";
import {
  bundleHistory,
  bundlesForSuite,
  commitFacts,
  fileAtCommit,
  removeRepository,
} from "./bundle.ts";
import { postgresForSuite, readingAs } from "./suite-postgres.ts";
import { arrangeWorkspace, principalFor, type Scenario } from "./workspace-with-bundle.ts";

/**
 * The governed write through the concepts slice's entry point (`[TEST1]`), against real
 * Postgres and a real bare repository: **one act, one commit, one transaction** (ADR 0012).
 *
 * The claims this suite exists for are the ones no unit test can make. That the commit is
 * the person's and the platform's at once, that a stale precondition is refused loudly, that
 * the lock makes two acts on one bundle one after the other, and — the load-bearing one —
 * that a failure after the commit leaves **no partial rows and a head ahead of the last
 * `bundle_commit`**, which is exactly the state T-056's reconciler is defined to find. Each
 * of those is a claim about two stores at once, so the seam is the slice over both of them.
 */

const db = postgresForSuite();
const bundles = bundlesForSuite();

/** This suite's footing: a provisioned workspace, its bundle, and its three people. */
const arrange = (): Promise<Scenario> => arrangeWorkspace(db(), bundles());

let minted = 0;
/**
 * A concept's IRI: the one opaque form ADR 0002's amendments fix — the bare apex, `/c/`, a
 * minted id — through the minter the boundary exports, so a test can never assert against a
 * shape the boundary would refuse. **No write here supplies one**: the key is never
 * caller-settable (ADR 0002), so a creation gets its IRI back from the act and a re-write
 * names that. This mints one only where a test needs an IRI nobody minted.
 */
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
  // OKF's own provenance shape: `resource` required, the platform's `locator` beside it, and
  // a `title` a reader recognises (`docs/okf-v02.md`).
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

/** A re-write of a concept an earlier act made: its IRI, its path and the head it left. */
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
  writeConcept(principal, { git: scenario.git, postgres: scenario.postgres }, input);

/**
 * The Editor's write, and what it landed. A test that is about the commit, the rows or the
 * read has no business restating "and it was not refused" in four lines; a test that is
 * about a refusal calls `write` above and reads the refusal itself.
 */
const landed = async (scenario: Scenario, input: WriteConceptInput) => {
  const result = await write(scenario, scenario.editor, input);
  if (!result.ok) throw new Error(`the write was refused: ${String(result.error)}`);
  return result.value;
};

/** Every row the act writes, counted as the superuser so the policy cannot hide a survivor. */
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

/** The shas `bundle_commit` knows about, oldest first — the prefix of git history it must be. */
const recordedCommits = async (workspaceId: string): Promise<readonly string[]> => {
  const rows = await db().pool.query<{ sha: string }>(
    "SELECT sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha",
    [workspaceId],
  );
  return rows.rows.map((row) => row.sha);
};

/** Run a read as this person, inside one transaction, the way a transport would. */
const reading = <T>(
  principal: UserPrincipal,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => readingAs(db().runtimePool, principal, work);

describe("a governed write", () => {
  it("lands one commit with the person as author and the platform bot as committer", async () => {
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

  it("carries the actor and the audit id in its trailers, and the audit id was minted before the commit", async () => {
    const scenario = await arrange();

    const written = await landed(scenario, writeFor());

    const facts = await commitFacts(scenario.git, scenario.workspaceId, written.sha);
    // The `Actor:` trailer is the kernel's ActorId — the person id, never their address,
    // which is what the git author line above carries instead (ADR 0035, `[AUDIT3]`).
    expect(facts.trailers).toEqual({
      Actor: `human:${scenario.editor.userId}`,
      Audit: written.auditEventId,
    });
    // Minted before the commit: the ledger row, the commit's trailer and the
    // `bundle_commit` row all hold the same id, which is what makes a replay idempotent.
    const joined = await db().pool.query<{ act: string; sha: string }>(
      `SELECT e.act, c.sha
         FROM audit_event e JOIN bundle_commit c
           ON c.workspace_id = e.workspace_id AND c.audit_event_id = e.id
        WHERE e.id = $1`,
      [written.auditEventId],
    );
    expect(joined.rows).toEqual([{ act: "knowledge.concept.committed", sha: written.sha }]);
  });

  it("writes the file to the bundle with its frontmatter, its body and its own IRI", async () => {
    const scenario = await arrange();
    const input = writeFor();

    const written = await landed(scenario, input);

    const file = await fileAtCommit(scenario.git, scenario.workspaceId, written.sha, input.path);
    // Every key quoted, because a concept's frontmatter is open and a key is whatever the
    // file carried; `sources[]` written as OKF's list of objects.
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
    // The hash on the row is the content's, not the file's: the trust keys and the IRI are
    // left out of it (ADR 0014), so recording a check never moves it.
    expect(written.contentHash).toBe(contentHashOf(input.frontmatter, input.body, input.path));
  });

  it("records the concept, its identity, the commit and its evidence in one transaction", async () => {
    const scenario = await arrange();
    const input = writeFor({
      evidence: [
        { sourceDocumentId: ulid(), locator: "p.4#para-2", resource: "Handbook (2026)" },
        { sourceDocumentId: ulid(), locator: "p.9", resource: "Handbook (2026)" },
      ],
    });

    const written = await landed(scenario, input);

    expect(await rowsFor(scenario.workspaceId)).toEqual({
      identities: "1",
      concepts: "1",
      commits: "1",
      evidence: "2",
      // The workspace's provisioning wrote the first, this act the second.
      events: "2",
      // The bundle-and-record delta, in the same transaction: the concept's node, and no
      // edge because nothing here links to a concept (ADR 0023).
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

  it("folds the row's kind for case and plural, and leaves the file's own spelling alone", async () => {
    const scenario = await arrange();
    // Three spellings of one kind. An unknown kind is the ordinary case, folded at write for
    // case and plural only (ADR 0012's 2026-08-30 amendment), so the type vocabulary counts
    // them once — while the file keeps what the person wrote, because `type` is not a key the
    // platform owns (ADR 0019).
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
    // The file said what its author said.
    if (firstFile === undefined) return;
    const file = await fileAtCommit(
      scenario.git,
      scenario.workspaceId,
      firstFile.sha,
      firstFile.path,
    );
    expect(file).toContain('"type": "policy"');
  });

  it("hashes two spellings of one source alike, and a swapped source differently", async () => {
    // ADR 0019's normalisation: `sources[]` reduced to ordered `(resource, locator)` pairs
    // with paths resolved to `/abs.md`. A link rewrite that only changes the spelling leaves
    // a check standing; a swapped source un-checks the concept.
    const body = "Expenses are claimed within thirty days.";
    const path = "knowledge/policies/expenses.md";
    const cite = (resource: string) => ({ sources: [{ resource, locator: "p.4" }] });

    const absolute = contentHashOf(cite("/knowledge/handbook.md"), body, path);
    const relative = contentHashOf(cite("./../handbook.md"), body, path);
    const bare = contentHashOf(cite("../handbook.md"), body, path);
    // An absolute spelling with dot segments is the same place: the normaliser runs on
    // absolute paths too, or two spellings of one citation would hash apart.
    const dotted = contentHashOf(cite("/knowledge/policies/../handbook.md"), body, path);
    const swapped = contentHashOf(cite("/knowledge/other.md"), body, path);

    expect([relative, bare, dotted]).toEqual([absolute, absolute, absolute]);
    expect(swapped).not.toBe(absolute);
    // A protocol-relative resource is external, like any URL: never folded into the
    // bundle's paths, so it cannot collide with a local concept's citation.
    expect(contentHashOf(cite("//knowledge/handbook.md"), body, path)).not.toBe(absolute);
    // Padding is not part of what a file cites, in **either** form: an asymmetry there would
    // give two spellings of one citation two hashes, and a concept would un-check itself over
    // whitespace.
    expect(contentHashOf(cite("  /knowledge/handbook.md  "), body, path)).toBe(absolute);
    expect(contentHashOf({ sources: ["  /knowledge/handbook.md  #p.4"] }, body, path)).toBe(
      absolute,
    );
    // A title the platform repaired is not the fact, and does not move the hash.
    expect(
      contentHashOf(
        { sources: [{ resource: "/knowledge/handbook.md", locator: "p.4", title: "Fixed" }] },
        body,
        path,
      ),
    ).toBe(absolute);
  });

  it("keeps the recorded commits a prefix of the bundle's history across a chain of acts", async () => {
    const scenario = await arrange();
    let head: string | null = null;
    const shas: string[] = [];
    for (const title of ["Expenses", "Travel", "Leave"]) {
      const written = await landed(scenario, writeFor({ title, expects: { head } }));
      shas.push(written.sha);
      head = written.sha;
    }

    // The invariant the lock buys and the reconciler leans on: what Postgres knows and what
    // git holds are the same list, in the same order (ADR 0012's 2026-09-06 amendment).
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(shas);
    expect(await recordedCommits(scenario.workspaceId)).toEqual(shas);
    const parents = await db().pool.query<{ sha: string; parent_sha: string | null }>(
      "SELECT sha, parent_sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha",
      [scenario.workspaceId],
    );
    expect(parents.rows.map((row) => row.parent_sha)).toEqual([null, shas[0], shas[1]]);
  });
});

/**
 * The bundle-and-record graph delta joins the act's transaction (ADR 0023, ADR 0032): an
 * edit's map change lands with its rows, in the live generation, and the map is never
 * behind for an edit — no watermark, no debounce, no *updating* phrase. The rows are
 * asserted as the superuser, and the walk through the graph door is the reader's proof.
 */
describe("the map a governed write leaves behind", () => {
  /**
   * A concept as these tests hold it: what the act was given, and the IRI the act answered
   * with. The IRI is never the input's — it is minted (ADR 0002) — so a test that asserts
   * about a concept reads it off the write that made it.
   */
  type Written = WriteConceptInput & { readonly iri: string };

  /**
   * A stable Product, then a stable concept whose body `write` renders over it — the
   * two-concept arrange the link-derivation tests share, so which act made which commit
   * is one fact here and a body per test.
   */
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

  it("maps the concept and its links in the transaction that committed them", async () => {
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
    // The link as ADR 0026 holds it: the two kinds, the section the link sits under and
    // the sentence around it, flattened to what a reader would say.
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
    // And the map answers at once: a Viewer's walk from the policy reaches the product.
    const steps = await reading(scenario.viewer, (principal, tx) =>
      walkFrom(principal, tx, policy.iri),
    );
    expect(steps.map((step) => ({ uid: step.uid, depth: step.depth }))).toEqual([
      { uid: policy.iri, depth: 0 },
      { uid: product.iri, depth: 1 },
    ]);
  });

  it("maps a link to not-yet-written knowledge when that knowledge lands", async () => {
    const scenario = await arrange();
    // A path link to a concept nobody has written: legal (docs/okf-v02.md), and no edge
    // yet, because a path is not an identity until the index holds it.
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

    // The landing is what resolves it: the author's edges are re-derived in the same act,
    // with the target's kind read off the index the transaction just wrote.
    const edges = await db().pool.query(
      "SELECT from_uid, to_uid, to_kind FROM graph_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([
      { from_uid: first.iri, to_uid: written.iri, to_kind: "Guideline" },
    ]);
  });

  it("reads a link however the markdown writes it — inline, by reference, shortcut or autolink", async () => {
    const scenario = await arrange();
    // Three references to one concept, three forms; the definition line's own bracket is
    // no link. Ordinals count every matched reference in document order — the skipped
    // definition included — so a form change never renumbers a neighbour.
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

  it("keeps images, quoted code and protocol-relative targets off the map a reader walks", async () => {
    const scenario = await arrange();
    // An image is a transclusion, code is quotation and `//host/…` points outside the
    // bundle — none asserts between concepts. The image still holds its ordinal —
    // removing the `!` later renumbers no neighbour — while code is blanked before the
    // scan and holds none. The fence closes on a longer run of its own character, as
    // CommonMark allows.
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

  it("keeps mapping an Editor's links past long unmatched backtick runs in the body", async () => {
    const scenario = await arrange();
    // The pairing the span scanner implements, against tenant input a backtracking regex
    // would choke on: an unpaired run is literal text, and a double-backtick span holding
    // a single backtick closes at the next run of exactly its own length. The middle
    // paragraph is the shape that once made the pairing rescan — many distinct unpaired
    // lengths followed by many paired short runs.
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

  it("backfills the map a reader walks when an edit lands on a concept the map had lost", async () => {
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

    // The derived rows vanish while the index stands — the shape of a workspace whose
    // concepts predate the graph tables, or of a restore that carried the records and not
    // the derived store.
    await db().pool.query("DELETE FROM graph_edge WHERE workspace_id = $1", [scenario.workspaceId]);
    await db().pool.query("DELETE FROM graph_node WHERE workspace_id = $1", [scenario.workspaceId]);

    // A re-write of the *cited* concept: newness is the map's own fact, not the index's,
    // so the policy that names it is re-derived — inbound path links included.
    await landed(scenario, { ...product, iri: first.iri, expects: { head: second.sha } });

    const edges = await db().pool.query(
      "SELECT from_uid, to_uid FROM graph_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([{ from_uid: second.iri, to_uid: first.iri }]);
  });

  it("derives a succession over a deprecated concept of its kind, and a derivation over anything else", async () => {
    const scenario = await arrange();
    // Two cited concepts, one difference: only the first is deprecated. ADR 0019's rule —
    // SUPERSEDES when a sources[].resource resolves to a status: deprecated concept of
    // the same type, else DERIVED_FROM — is the whole distinction.
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
    // One `lineage:` uid prefix for both labels, so a later relabel moves no key; the
    // lineage columns stay empty — the link columns are LINKS_TO's alone.
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

  it("relabels a successor's lineage when the concept it cites is deprecated", async () => {
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
    // Cited while current: a derivation.
    expect(await lineageLabel()).toEqual(["DERIVED_FROM"]);

    // The deprecation commit — a re-write of the cited concept alone — revisits its
    // inbound lineage (ADR 0019), so the successor's edge flips with no edit to it.
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
  it("refuses a write against a head that has moved, loudly and without a commit", async () => {
    const scenario = await arrange();
    await landed(scenario, writeFor());

    // The second write was written against an empty bundle, which is no longer what the
    // ref holds: the person is told, rather than silently overwriting the first.
    const stale = await write(scenario, scenario.editor, writeFor({ expects: { head: null } }));

    expect(stale).toEqual({ ok: false, error: "stale-precondition" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await recordedCommits(scenario.workspaceId)).toHaveLength(1);
  });

  it("refuses a Viewer before anything is committed", async () => {
    const scenario = await arrange();

    const refused = await write(scenario, scenario.viewer, writeFor());

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
    expect(await rowsFor(scenario.workspaceId)).toMatchObject({ concepts: "0", commits: "0" });
  });

  it("refuses a workspace with no bundle, rather than making one nobody asked for", async () => {
    const scenario = await arrange();
    // A member of a real workspace whose bundle is not on disk: authority passes and the
    // store is what is missing, which is the only way to reach this refusal — the act checks
    // who is asking before it goes near a repository.
    await removeRepository(scenario.git, scenario.workspaceId);

    const refused = await write(scenario, scenario.editor, writeFor());

    expect(refused).toEqual({ ok: false, error: "no-such-repository" });
  });

  // A second concept at a path the bundle already holds is refused too — `path-taken` —
  // and it is asserted where its whole consequence is: the first test below, which reads
  // the refusal *and* the state it leaves in both stores.

  it.each([
    ["outside the bundle's concept area", "elsewhere/expenses.md"],
    ["at the bundle's reserved manifest", "knowledge/manifest.yaml"],
    ["out of the tree altogether", "knowledge/../../escape.md"],
  ])("refuses a path %s, and makes no commit", async (_why, path) => {
    const scenario = await arrange();

    const refused = await write(scenario, scenario.editor, writeFor({ path }));

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
  });

  it("refuses a trailer value carrying a newline, whatever its type promised", async () => {
    const scenario = await arrange();

    // The door's own guard, reached directly: every caller's `Audit:` is a minted id today,
    // so the type refuses this — and the door refuses it again for the caller that arrives
    // without the compiler.
    const forged = await commit(scenario.editor, scenario.git, {
      path: "knowledge/expenses.md",
      content: "---\n---\n\nbody\n",
      message: "Record the expenses policy",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      trailers: { actor: `human:${scenario.editor.userId}`, audit: `${ulid()}\nRun: forged` },
      expectedHead: null,
    });

    expect(forged).toEqual({ ok: false, error: "malformed-message" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
  });

  it("refuses a message carrying a newline, so a forged trailer never reaches a commit", async () => {
    const scenario = await arrange();

    // The attack the trailers invite: a subject that ends the message and opens its own
    // `Audit:` line. A first-match parse would read the forged id, and the idempotency index
    // would then treat an unrecorded commit as one that already landed.
    const forged = await write(
      scenario,
      scenario.editor,
      writeFor({ message: `Record the policy\n\nAudit: ${ulid()}` }),
    );

    expect(forged).toEqual({ ok: false, error: "malformed-message" });
    expect(await head(scenario.editor, scenario.git)).toBeNull();
  });
});

/**
 * A concept's **class** and its **path** are minted by the act that creates it and moved by
 * nothing this act does (ADR 0012, ADR 0023). Three ways to try, and the same answer to each,
 * decided before any commit is made.
 */
describe("what a re-write of an existing concept may not move", () => {
  it("refuses a named widening of an existing concept's class, and makes no commit", async () => {
    const scenario = await arrange();
    const input = writeFor({ sensitivity: "Restricted" });
    const first = await landed(scenario, input);

    // The Admin, who may see a Restricted concept: an Editor is refused a step earlier, as
    // for a concept nobody minted (`visibility.test.ts`), and never reaches this word.
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

  it("keeps an existing concept's class when the write names none, rather than narrowing it", async () => {
    const scenario = await arrange();
    const input = writeFor({ sensitivity: "Internal" });
    const first = await landed(scenario, input);

    // No `sensitivity` on the second write. The act's default is the most restrictive of the
    // three, which on a *re-write* would silently narrow a concept its readers can see today.
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

  it("keeps an existing concept's status when the write names none, rather than un-publishing it", async () => {
    const scenario = await arrange();
    const input = writeFor({ status: "stable" });
    const first = await landed(scenario, input);

    // No `status` on the second write. The act's default is *draft* — what a concept is born
    // at — and applying it here would take a published concept away from every reader.
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

  it("refuses moving an existing concept to another path, and makes no commit", async () => {
    const scenario = await arrange();
    const input = writeFor();
    const first = await landed(scenario, input);

    const moved = await write(
      scenario,
      scenario.editor,
      rewriteOf(input, first, { path: "knowledge/moved.md" }),
    );

    expect(moved).toEqual({ ok: false, error: "rename-refused" });
    // No commit either: a rename that refused after committing would leave a file at a path
    // no row names, and a replay that refuses for ever.
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });
});

/**
 * Revoke the Editor's credentials — an Admin's, in this workspace, or the operator's
 * everywhere. Both write an **instant**, never a deletion and never a state (ADR 0035), which
 * is what makes "is this person revoked" a question only the acting credential's own issuance
 * can answer.
 *
 * The instant is **bound**, the way `revokeCredentials` binds its `at`, and never Postgres's
 * `now()`. The resolver decides revocation by comparing this instant against the credential's
 * own issuance, and that issuance is stamped by this process — so `now()` would answer one
 * side of the comparison from the container's clock and the other from the host's. Only
 * milliseconds separate the two events, which is the size of the offset between two clocks,
 * so their order would be settled by drift rather than by the order the test wrote them in:
 * a refusal that never arrives, or one that arrives for a credential minted afterwards.
 * Bound from here, one clock answers both sides. Production never has the question — the act
 * takes its instant from the app's own clock as a parameter.
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

/** The revocation, run on a client of the caller's choosing — the pool, or one held open. */
const revoke = (
  client: { query: (statement: string, parameters: readonly unknown[]) => Promise<unknown> },
  scenario: Scenario,
  scope: RevocationScope,
): Promise<unknown> =>
  client.query(REVOCATIONS[scope].statement, REVOCATIONS[scope].parameters(scenario, new Date()));

const revokeEditor = (scenario: Scenario, scope: RevocationScope): Promise<unknown> =>
  revoke(db().pool, scenario, scope);

/** Which backend a held connection is, so a test can ask Postgres about that one alone. */
const backendPidOf = async (client: pg.PoolClient): Promise<number> => {
  const found = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = found.rows[0]?.pid;
  if (pid === undefined) throw new Error("the connection did not name its backend");
  return pid;
};

/** Whether that backend is waiting on a lock — Postgres's own account of it, not a guess. */
const isBlockedOnALock = async (pid: number): Promise<boolean> => {
  const found = await db().pool.query("SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted", [
    pid,
  ]);
  return (found.rowCount ?? 0) > 0;
};

/**
 * Wait for a condition the database reports, polling rather than sleeping: a slow machine
 * takes more turns to see the same state instead of failing a stopwatch. The cap is a
 * runaway guard, not a timing assumption — the test fails on it only if the state never
 * arrives at all.
 */
const until = async (condition: () => Promise<boolean>): Promise<void> => {
  for (let turn = 0; turn < 200; turn += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the condition never held");
};

/** What a refused act leaves behind: no rows of its own, and every commit it made still there. */
const expectCommitsWithoutRows = async (scenario: Scenario, commits: number): Promise<void> => {
  expect(await rowsFor(scenario.workspaceId)).toMatchObject({ concepts: "0", commits: "0" });
  expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(commits);
};

/**
 * Authority is judged **at time-of-act**, in the transaction that writes the rows — and
 * again in the read the act makes before it commits, which is why a revocation that has
 * already landed costs no commit at all. The window the reconciler exists for is what is
 * left: between that read and the write transaction, which no test can enter without a hook
 * inside the act. What every case here shares is the answer — the rows refuse.
 */
describe("authority that moved while the act was in flight", () => {
  it("refuses a writer whose role moved, before a commit is made", async () => {
    const scenario = await arrange();
    // The Principal was resolved as an Editor; the membership says Viewer by the time the
    // act reads it. The door re-reads the membership in the transaction it opens, so the
    // authority the act writes under is the row's and never the caller's.
    await db().pool.query(
      "UPDATE member SET role = 'Viewer' WHERE workspace_id = $1 AND user_id = $2",
      [scenario.workspaceId, scenario.editor.userId],
    );

    const refused = await write(scenario, scenario.editor, writeFor());

    expect(refused).toEqual({ ok: false, error: "role-disagrees" });
    await expectCommitsWithoutRows(scenario, 0);
  });

  it.each(["here", "everywhere"] as const)(
    "refuses a writer whose credentials were revoked %s, before a commit is made",
    async (scope) => {
      const scenario = await arrange();
      await revokeEditor(scenario, scope);

      const refused = await write(scenario, scenario.editor, writeFor());

      // One word for both scopes, as the boundary answers them (ADR 0035).
      expect(refused).toEqual({ ok: false, error: "credentials-revoked" });
      await expectCommitsWithoutRows(scenario, 0);
    },
  );

  it("lets a credential minted after a revocation write, because the instant ends what was issued", async () => {
    const scenario = await arrange();
    // A revocation, then a fresh sign-in. ADR 0035's rule is that both scopes end what was
    // *issued* and a fresh sign-in mints anew, so the act's judgement is the boundary's —
    // the credential's issuance against the instant — and never "an instant is set".
    await revokeEditor(scenario, "here");
    const afresh = await principalFor(db(), scenario.workspaceId, scenario.editor.userId);

    const written = await write(scenario, afresh, writeFor());

    expect(written.ok).toBe(true);
  });

  it("refuses a writer whose membership ended, before a commit is made", async () => {
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
    "makes a revocation %s wait for the act holding the membership, and refuses the act after it",
    async (scope) => {
      const scenario = await arrange();
      // The lock the act's door takes (`FOR SHARE OF m, u`) is what makes ADR 0012's
      // *impossible by construction* a construction: a revocation of either row cannot land
      // between the door's read and the act's COMMIT. Driven through the door's own callback,
      // which is the seam that lets a test hold the act's transaction open.
      const revoker = await db().pool.connect();
      let settled = false;
      let waiting: Promise<unknown> = Promise.resolve();
      try {
        const pid = await backendPidOf(revoker);
        await withMembership(scenario.editor, scenario.postgres, async () => {
          // Fired while the act's transaction holds the rows, and **never awaited in here**:
          // the act is what releases the lock, so waiting for the revocation inside the act
          // would be the act waiting for itself.
          waiting = revoke(revoker, scenario, scope).then(() => {
            settled = true;
          });

          // Waited for as a **state Postgres reports**, never a stretch of wall clock: the
          // revoking backend is asked for repeatedly until it says it is blocked on a lock,
          // so a starved runner takes longer to observe the same fact rather than failing.
          await until(() => isBlockedOnALock(pid));
          // Blocked, and therefore not done — which is the whole claim.
          expect(settled).toBe(false);
        });

        await waiting;
        // Released by the act's COMMIT, and only then.
        expect(settled).toBe(true);
      } finally {
        revoker.release();
      }

      // And the revocation, now committed, refuses the next act's rows — with no commit,
      // because the act reads its authority before it reaches git.
      const refused = await write(scenario, scenario.editor, writeFor());
      expect(refused).toEqual({ ok: false, error: "credentials-revoked" });
      await expectCommitsWithoutRows(scenario, 0);
    },
  );
});

/**
 * The window ADR 0012's amendment governs: between the commit and the act's transaction. A
 * failure there is not a bug to be prevented — it is the state the reconciler is defined
 * for, and this is the test that says what it looks like.
 */
describe("a failure after the commit", () => {
  it("leaves no partial rows, and a head ahead of the last recorded commit", async () => {
    const scenario = await arrange();
    const first = writeFor();
    const written = await landed(scenario, first);
    const before = await rowsFor(scenario.workspaceId);

    // A second concept at a path the index already holds: the commit is made — the file is
    // real and git accepted it — and then the unique index refuses the row.
    const clash = await write(
      scenario,
      scenario.editor,
      writeFor({ path: first.path, expects: { head: written.sha } }),
    );

    // `[TEST8]`: the rows are asserted before the returned value, because a statement that
    // failed inside a transaction is only proved by what the transaction left. Nothing
    // landed — not the identity, not the index row, not the commit row, and not the ledger
    // row, which was written first inside the transaction, so this proves it rolled back
    // with the act rather than that it was never reached (`[AUDIT1]`).
    expect(await rowsFor(scenario.workspaceId)).toEqual(before);
    // And the shape the reconciler finds: git is one commit ahead of what Postgres knows.
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    const recorded = await recordedCommits(scenario.workspaceId);
    expect(history).toHaveLength(2);
    expect(recorded).toEqual([history[0]]);
    expect(await head(scenario.editor, scenario.git)).toBe(history[1]);
    expect(clash).toEqual({ ok: false, error: "path-taken" });
  });
});

describe("the per-repository lock", () => {
  it("runs one act at a time per bundle, and lets another bundle's act through beside it", async () => {
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

    // The two acts on one bundle never overlap; the third is on another bundle and is not
    // serialised against them, which is why the lock is per repository and not global.
    const sameBundle = order.filter((step) => !step.startsWith("elsewhere"));
    expect(sameBundle).toEqual(["first in", "first out", "second in", "second out"]);
    expect(order).toContain("elsewhere out");
  });

  it("holds the bundle through the whole act, so two writes racing one head leave one commit", async () => {
    const scenario = await arrange();

    // Both were written against an empty bundle. Without the lock spanning the act, both
    // could read the same head; with it, the second sees what the first left and is refused.
    const [first, second] = await Promise.all([
      write(scenario, scenario.editor, writeFor()),
      write(scenario, scenario.editor, writeFor()),
    ]);

    expect([first?.ok, second?.ok].toSorted()).toEqual([false, true]);
    const refused = first?.ok === false ? first : second;
    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(1);
    expect(await recordedCommits(scenario.workspaceId)).toEqual(history);
  });

  it("releases the bundle when an act fails inside it, so the next act is not blocked behind it", async () => {
    const scenario = await arrange();
    await landed(scenario, writeFor());
    // A failure the act meets **inside** the lock — the precondition is read there — rather
    // than one decided before it is taken, which would prove nothing about releasing it.
    const failed = await write(scenario, scenario.editor, writeFor({ expects: { head: null } }));
    expect(failed).toEqual({ ok: false, error: "stale-precondition" });

    const head = await bundleHistory(scenario.git, scenario.workspaceId);
    const next = await landed(scenario, writeFor({ expects: { head: head[0] ?? null } }));

    expect(next.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("opening a concept by IRI", () => {
  it("hands the reader the concept the write committed, unchecked until somebody checks it", async () => {
    const scenario = await arrange();
    const input = writeFor({ status: "stable" });
    const written = await landed(scenario, input);

    const opened = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }),
    );

    expect(opened.ok).toBe(true);
    if (!opened.ok || !opened.value.found) return;
    expect(opened.value.concept).toEqual({
      iri: written.iri,
      // The file carries the status the act named beside its IRI, so the row and the
      // reconciler's replay of the commit read the same thing off it (T-056).
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
    // A draft is a concept nobody has made the company's word on yet: it has no published
    // instant, and the predicate's published arm is what keeps it out of every read.
    const input = writeFor({ status: "draft" });
    const written = await landed(scenario, input);

    const seen = await Promise.all(
      [scenario.viewer, scenario.editor, scenario.admin].map((principal) =>
        reading(principal, (resolved, tx) => open(resolved, tx, { iri: written.iri })),
      ),
    );

    expect(seen.map((result) => result.ok && result.value.found)).toEqual([false, false, false]);
    const stored = await db().pool.query<{ published_at: Date | null }>(
      "SELECT published_at FROM concept_index WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.iri],
    );
    expect(stored.rows).toEqual([{ published_at: null }]);
  });

  it("reads a person's check off the verification record, and says so when the content moved", async () => {
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
      open(principal, tx, { iri: written.iri }),
    );
    expect(opened.ok && opened.value.found && opened.value.concept?.trust).toMatchObject({
      tier: "human-reviewed",
      status: "current",
      checkedBy: `human:${scenario.admin.userId}`,
    });

    // The same concept written again moves the content hash past the check's, and the trust
    // status says so without anybody recording anything (ADR 0019).
    await landed(
      scenario,
      rewriteOf(input, written, { body: "Expenses are claimed within sixty days." }),
    );
    const moved = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }),
    );
    expect(moved.ok && moved.value.found && moved.value.concept?.trust.status).toBe(
      "changed-since-checked",
    );
  });

  /**
   * `stale_after` is the whole of *Out of date* and absence means no shelf life (ADR 0019), so
   * a reader is told exactly what any other consumer of the same file would derive — and told
   * nothing at all from a value that is not one of the two forms the ADR names. The far-future
   * dates keep these cases true for the next thousand years rather than the next few.
   */
  const SHELF_LIVES: readonly (readonly [string, string | undefined, TrustStatus])[] = [
    ["no shelf life at all", undefined, "current"],
    ["a date long past", "2020-01-01", "out-of-date"],
    // The boundary of the date-only form: a shelf life lasts *through* the day it names, so a
    // date that has not ended yet is not past — and one that ended is.
    ["today, which the concept lasts through", new Date().toISOString().slice(0, 10), "current"],
    ["a date far ahead", "3000-01-01", "current"],
    ["an offset datetime long past", "2020-01-01T00:00:00Z", "out-of-date"],
    ["an offset datetime far ahead", "3000-01-01T00:00:00+01:00", "current"],
    // Outside the grammar: an impossible calendar day, an offsetless datetime `Date` would
    // read as local time, and a sentence. None of them is a shelf life.
    ["an impossible calendar day", "2026-02-30", "current"],
    ["a datetime with no offset", "2020-01-01T00:00:00", "current"],
    ["a two-digit year `Date` would remap", "0020-01-01", "out-of-date"],
    ["something that is not a date", "when the contract ends", "current"],
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
      open(principal, tx, { iri: written.iri }),
    );

    expect(read.ok && read.value.found && read.value.concept?.trust.status).toBe(expected);
  });

  it("withholds a Restricted concept from a Viewer exactly as it answers an IRI nobody minted", async () => {
    const scenario = await arrange();
    const input = writeFor({ sensitivity: "Restricted", status: "stable" });
    const written = await landed(scenario, input);

    const withheld = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: written.iri }),
    );
    const absent = await reading(scenario.viewer, (principal, tx) =>
      open(principal, tx, { iri: iriFor() }),
    );

    // Indistinguishable, which is the whole requirement: the same shape, and neither says
    // anything a caller could probe with (user story 13).
    expect(withheld).toEqual({ ok: true, value: { found: false, iri: written.iri } });
    expect(absent.ok && absent.value.found).toBe(false);
    // The Admin, who may see it, is the proof the concept is really there.
    const seen = await reading(scenario.admin, (principal, tx) =>
      open(principal, tx, { iri: written.iri }),
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
