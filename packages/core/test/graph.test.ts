import { conceptIriOf, ulid } from "@better-answers/schema";
import type { TestData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "pg";

import {
  GRAPH_WALK_DEPTH,
  GRAPH_WALK_ROW_LIMIT,
  walkFrom,
  walkTo,
  writeConceptDelta,
  type ConceptDelta,
  type WalkStep,
} from "@better-answers/core/store/graph";
import { postgresForSuite, readingAs, seedingWith } from "./suite-postgres.ts";

/**
 * The graph door through its interface (`[TEST1]`), over factory-seeded rows on real
 * Postgres — both halves of it.
 *
 * The traversal templates: depth capped at 4 by the template, the read predicate applied on
 * **every element of every path** — a path with one withheld element is no path — the live
 * generation bound on every step, and never another workspace's rows, whoever asks
 * (`[SEC3]`: what a walk refuses is the claim, not what it returns).
 *
 * And the delta the governed write's transaction runs. `concepts.test.ts` proves the delta
 * through an act, which is where the one-act-one-transaction claim belongs; the tests here
 * are the **second** deltas — an edit that removes a link, a kind that moves, a cited
 * concept re-committed without being deprecated — each of which needs a concept's index row
 * moved between two deltas rather than written once.
 */

const db = postgresForSuite();

/** A workspace with an Admin and a Viewer, and its factory — the arrange every walk needs. */
type MapScenario = {
  readonly workspaceId: string;
  readonly admin: { readonly workspaceId: string; readonly userId: string };
  readonly viewer: { readonly workspaceId: string; readonly userId: string };
};

const seeded = <T>(work: (seed: TestData) => Promise<T>): Promise<T> =>
  seedingWith(db().pool, work);

const arrange = (): Promise<MapScenario> =>
  seeded(async (seed) => {
    const workspace = await seed.workspace();
    const admin = await seed.member({ workspaceId: workspace.id, role: "Admin" });
    const viewer = await seed.member({ workspaceId: workspace.id, role: "Viewer" });
    return {
      workspaceId: workspace.id,
      admin: { workspaceId: workspace.id, userId: admin.userId },
      viewer: { workspaceId: workspace.id, userId: viewer.userId },
    };
  });

const walked = (
  reader: MapScenario["admin"],
  uid: string,
  direction: typeof walkFrom = walkFrom,
): Promise<readonly WalkStep[]> =>
  readingAs(db().runtimePool, reader, (principal, tx) => direction(principal, tx, uid));

const uidsByDepth = (steps: readonly WalkStep[]): readonly (readonly [string, number])[] =>
  steps.map((step) => [step.uid, step.depth]);

describe("a graph walk", () => {
  it("reaches everything within four hops of the entry, and nothing past the template's cap", async () => {
    const scenario = await arrange();
    const uids = await seeded(async (seed) => {
      const chain: string[] = [];
      for (let at = 0; at <= GRAPH_WALK_DEPTH + 1; at += 1) {
        const node = await seed.graphNode({ workspaceId: scenario.workspaceId });
        const previous = chain.at(-1);
        if (previous !== undefined) {
          await seed.graphEdge({
            workspaceId: scenario.workspaceId,
            fromUid: previous,
            toUid: node.uid,
          });
        }
        chain.push(node.uid);
      }
      return chain;
    });

    const steps = await walked(scenario.viewer, uids[0] ?? "");

    // Five elements — the entry and four hops — and never the sixth: the depth is the
    // template's literal, so no caller can widen it.
    expect(uidsByDepth(steps)).toEqual(
      uids.slice(0, GRAPH_WALK_DEPTH + 1).map((uid, depth) => [uid, depth]),
    );
  });

  /**
   * Three ways an element of a path can be withheld — its class, its edge's class, its
   * missing published instant — and one answer to each: the path ends before it. What lies
   * beyond the withheld element is invisible *through it* even when the far node is one
   * the reader could see directly.
   */
  const WITHHELD: readonly (readonly [
    string,
    { readonly node?: object; readonly edge?: object; readonly adminSees: boolean },
  ])[] = [
    ["a Restricted middle concept", { node: { sensitivity: "Restricted" }, adminSees: true }],
    ["a Restricted middle edge", { edge: { sensitivity: "Restricted" }, adminSees: true }],
    // Unpublished withholds from every reader, Admins included: publication is the
    // predicate's first arm, not a privilege.
    ["an unpublished middle concept", { node: { publishedAt: null }, adminSees: false }],
  ];

  it.each(WITHHELD)("excludes every path through %s, for the whole path", async (_what, shape) => {
    const scenario = await arrange();
    const { entry, middle, far } = await seeded(async (seed) => {
      const a = await seed.graphNode({ workspaceId: scenario.workspaceId });
      const b = await seed.graphNode({ workspaceId: scenario.workspaceId, ...shape.node });
      const c = await seed.graphNode({ workspaceId: scenario.workspaceId });
      await seed.graphEdge({
        workspaceId: scenario.workspaceId,
        fromUid: a.uid,
        toUid: b.uid,
        ...shape.edge,
      });
      await seed.graphEdge({ workspaceId: scenario.workspaceId, fromUid: b.uid, toUid: c.uid });
      return { entry: a.uid, middle: b.uid, far: c.uid };
    });

    // The Viewer's walk holds the entry alone: the middle is withheld, and the far node —
    // readable in itself — is unreachable through it. No count, no hint (`[SEC2]`).
    const viewer = await walked(scenario.viewer, entry);
    expect(uidsByDepth(viewer)).toEqual([[entry, 0]]);

    const admin = await walked(scenario.admin, entry);
    expect(admin.map((step) => step.uid).includes(far)).toBe(shape.adminSees);
    expect(admin.map((step) => step.uid).includes(middle)).toBe(shape.adminSees);
  });

  it("answers a withheld entry exactly as it answers one nobody mapped", async () => {
    const scenario = await arrange();
    const restricted = await seeded((seed) =>
      seed.graphNode({ workspaceId: scenario.workspaceId, sensitivity: "Restricted" }),
    );

    const withheld = await walked(scenario.viewer, restricted.uid);
    const absent = await walked(
      scenario.viewer,
      "https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ",
    );

    // Indistinguishable, which is the requirement: nothing to probe with.
    expect(withheld).toEqual([]);
    expect(absent).toEqual([]);
  });

  it("never answers across workspaces, even through an edge that names another tenant's node", async () => {
    const ours = await arrange();
    const theirs = await arrange();
    const { home, theirEntry, theirFar } = await seeded(async (seed) => {
      const mine = await seed.graphNode({ workspaceId: ours.workspaceId });
      const from = await seed.graphNode({ workspaceId: theirs.workspaceId });
      const to = await seed.graphNode({ workspaceId: theirs.workspaceId });
      await seed.graphEdge({
        workspaceId: theirs.workspaceId,
        fromUid: from.uid,
        toUid: to.uid,
      });
      // The adversarial row: an edge of OUR workspace aiming at THEIR node. The policy
      // admits it — the row is ours — and the walk's node join is what keeps it a dead
      // end, because their node is not a row our scope can reach.
      await seed.graphEdge({
        workspaceId: ours.workspaceId,
        fromUid: mine.uid,
        toUid: to.uid,
      });
      return { home: mine.uid, theirEntry: from.uid, theirFar: to.uid };
    });

    // Their entry answers nothing here, as if never mapped; and the edge that names their
    // node walks nowhere. Their own Admin still walks their own map — the rows are real.
    expect(await walked(ours.admin, theirEntry)).toEqual([]);
    expect(uidsByDepth(await walked(ours.admin, home))).toEqual([[home, 0]]);
    expect(uidsByDepth(await walked(theirs.admin, theirEntry))).toEqual([
      [theirEntry, 0],
      [theirFar, 1],
    ]);
  });

  it("binds the live generation on every element, so a rebuild is one row update and source entities walk beside it", async () => {
    const scenario = await arrange();
    const { entry, liveFar, nextFar, entity } = await seeded(async (seed) => {
      // Generation 1 is live: an entry, a hop, and a source entity naming the entry —
      // which carries no generation, because it is reconciled per document (ADR 0023).
      const a = await seed.graphNode({ workspaceId: scenario.workspaceId });
      const b = await seed.graphNode({ workspaceId: scenario.workspaceId });
      await seed.graphEdge({ workspaceId: scenario.workspaceId, fromUid: a.uid, toUid: b.uid });
      const person = await seed.graphNode({
        workspaceId: scenario.workspaceId,
        gen: null,
        label: "source-entity:Person",
        kind: null,
      });
      await seed.graphEdge({
        workspaceId: scenario.workspaceId,
        gen: null,
        label: "IS_CONCEPT",
        fromUid: person.uid,
        toUid: a.uid,
        uid: `is_concept:${person.uid}`,
      });
      // Generation 2, written beside the live one: the same entry uid, a different hop.
      const rebuiltEntry = await seed.graphNode({
        workspaceId: scenario.workspaceId,
        gen: 2,
        uid: a.uid,
      });
      const c = await seed.graphNode({ workspaceId: scenario.workspaceId, gen: 2 });
      await seed.graphEdge({
        workspaceId: scenario.workspaceId,
        gen: 2,
        fromUid: rebuiltEntry.uid,
        toUid: c.uid,
      });
      return { entry: a.uid, liveFar: b.uid, nextFar: c.uid, entity: person.uid };
    });

    const before = await walked(scenario.viewer, entry);
    expect(before.map((step) => step.uid).toSorted()).toEqual([entry, liveFar].toSorted());
    // The source entity reaches the same entry against the edge's direction.
    const inbound = await walked(scenario.viewer, entry, walkTo);
    expect(inbound.map((step) => step.uid).toSorted()).toEqual([entry, entity].toSorted());

    // The flip: one row update, and every read binds the next generation at once.
    await db().pool.query("UPDATE graph_generation SET live_gen = 2 WHERE workspace_id = $1", [
      scenario.workspaceId,
    ]);

    const after = await walked(scenario.viewer, entry);
    expect(after.map((step) => step.uid).toSorted()).toEqual([entry, nextFar].toSorted());
    expect(after.map((step) => step.uid)).not.toContain(liveFar);
  });

  it("caps a walk's answer at the template's row limit, so a dense map cannot demand unbounded work", async () => {
    const scenario = await arrange();
    const uids = await seeded(async (seed) => {
      const nodes: string[] = [];
      for (let at = 0; at < 8; at += 1) {
        nodes.push((await seed.graphNode({ workspaceId: scenario.workspaceId })).uid);
      }
      for (const from of nodes) {
        for (const to of nodes) {
          if (from === to) continue;
          await seed.graphEdge({ workspaceId: scenario.workspaceId, fromUid: from, toUid: to });
        }
      }
      return nodes;
    });

    const steps = await walked(scenario.admin, uids[0] ?? "");

    // A complete map of eight concepts holds 1,099 paths within four hops of one entry;
    // the template's own limit is what the caller gets instead, closest rows first.
    expect(steps.length).toBe(GRAPH_WALK_ROW_LIMIT);
  });

  it("answers with the path's node fields alone — nothing off an edge reaches a reader", async () => {
    const scenario = await arrange();
    const entry = await seeded(async (seed) => {
      const a = await seed.graphNode({ workspaceId: scenario.workspaceId });
      await seed.graphEdge({ workspaceId: scenario.workspaceId, fromUid: a.uid });
      return a.uid;
    });

    const steps = await walked(scenario.admin, entry);

    // An edge's columns name and quote another file (`to_uid`, `to_kind`, the sentence),
    // and the from-side's visibility says nothing about the target — so until a surface
    // applies the target's own predicate to an edge read (the door's rule; T-055, B9), a
    // step is exactly a node: these five fields and no more.
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(Object.keys(step).toSorted()).toEqual(["depth", "kind", "label", "path", "uid"]);
    }
  });
});

type IndexRow = Awaited<ReturnType<TestData["conceptIndex"]>>;

/** A concept the index holds — what a delta's targets resolve against. */
const conceptIn = (scenario: MapScenario, overrides: Partial<IndexRow>): Promise<IndexRow> =>
  seeded((seed) => seed.conceptIndex({ workspaceId: scenario.workspaceId, ...overrides }));

/** The delta a governed write hands the door for a concept whose row reads like this. */
const deltaOf = (row: IndexRow, overrides: Partial<ConceptDelta> = {}): ConceptDelta => {
  // The column is nullable and the factory never leaves it so; the throw is what a test
  // reads instead of a fallback that would derive edges from a frontmatter nobody wrote.
  if (row.frontmatter === null) throw new Error("the seeded concept carries no frontmatter");
  return {
    workspaceId: row.workspaceId,
    iri: row.iri,
    kind: row.kind,
    path: row.path,
    body: row.body,
    frontmatter: row.frontmatter,
    publishedAt: row.publishedAt,
    sensitivity: row.sensitivity,
    audience: row.audience,
    audienceGroups: row.audienceGroups,
    status: row.status,
    ...overrides,
  };
};

const land = (scenario: MapScenario, delta: ConceptDelta): Promise<void> =>
  readingAs(db().runtimePool, scenario.admin, (principal, tx) =>
    writeConceptDelta(principal, tx, delta),
  );

/** The commit's own write to `concept_index`, which the delta below is derived beside. */
const amend = async (
  iri: string,
  changes: { readonly kind?: string; readonly body?: string; readonly status?: string },
): Promise<void> => {
  await db().pool.query(
    `UPDATE concept_index
        SET kind = COALESCE($2, kind), body = COALESCE($3, body), status = COALESCE($4, status)
      WHERE iri = $1`,
    [iri, changes.kind ?? null, changes.body ?? null, changes.status ?? null],
  );
};

type EdgeFacts = {
  readonly label: string;
  readonly to_uid: string;
  readonly to_kind: string | null;
};

/** The `graph_edge` rows leaving one node, projected to the columns a test asserts on. */
const edgeRowsFrom = async <Row extends QueryResultRow>(
  scenario: MapScenario,
  fromUid: string,
  columns: string,
): Promise<readonly Row[]> => {
  const rows = await db().pool.query<Row>(
    `SELECT ${columns} FROM graph_edge WHERE workspace_id = $1 AND from_uid = $2 ORDER BY uid`,
    [scenario.workspaceId, fromUid],
  );
  return rows.rows;
};

const edgesFrom = (scenario: MapScenario, fromUid: string): Promise<readonly EdgeFacts[]> =>
  edgeRowsFrom<EdgeFacts>(scenario, fromUid, "label, to_uid, to_kind");

/**
 * A Product and a Policy whose body links to it, both in the index and **neither yet on the
 * map** — the footing the tests about a *second* delta open with, because each of them has to
 * move one of the pair between two deltas and watch what the re-derive does.
 */
const linkedPair = async (): Promise<{
  readonly scenario: MapScenario;
  readonly product: IndexRow;
  readonly policy: IndexRow;
}> => {
  const scenario = await arrange();
  const product = await conceptIn(scenario, { path: "knowledge/product.md", kind: "Product" });
  const policy = await conceptIn(scenario, {
    path: "knowledge/policy.md",
    kind: "Policy",
    body: "See [the product](./product.md) for tiers.",
  });
  return { scenario, product, policy };
};

describe("the delta a second commit runs", () => {
  it("takes a link the edit removed off the map, rather than leaving a phantom edge", async () => {
    const { scenario, product, policy } = await linkedPair();
    await land(scenario, deltaOf(policy));
    expect(await edgesFrom(scenario, policy.iri)).toEqual([
      { label: "LINKS_TO", to_uid: product.iri, to_kind: "Product" },
    ]);

    const withoutTheLink = "Tiers are listed in the price book.";
    await amend(policy.iri, { body: withoutTheLink });
    await land(scenario, deltaOf(policy, { body: withoutTheLink }));

    expect(await edgesFrom(scenario, policy.iri)).toEqual([]);
  });

  it("keeps an inbound link's denormalised kind in step when the target's own kind moves", async () => {
    const { scenario, product, policy } = await linkedPair();
    // The target lands on the map first: a concept newly mapped re-derives every file that
    // names it, and that re-derive would carry the new kind whether or not the sync ran.
    await land(scenario, deltaOf(product));
    await land(scenario, deltaOf(policy));

    await amend(product.iri, { kind: "Procedure" });
    await land(scenario, deltaOf(product, { kind: "Procedure" }));

    expect(await edgesFrom(scenario, policy.iri)).toEqual([
      { label: "LINKS_TO", to_uid: product.iri, to_kind: "Procedure" },
    ]);
  });

  it("leaves a citer's lineage where it is until the cited concept is actually deprecated", async () => {
    const scenario = await arrange();
    const cited = await conceptIn(scenario, { path: "knowledge/expenses.md", kind: "Policy" });
    const successor = await conceptIn(scenario, {
      path: "knowledge/expenses-v2.md",
      kind: "Policy",
      frontmatter: { title: "Expenses v2", type: "Policy", sources: [{ resource: cited.iri }] },
    });
    await land(scenario, deltaOf(cited));
    await land(scenario, deltaOf(successor));
    expect(await edgesFrom(scenario, successor.iri)).toEqual([
      { label: "DERIVED_FROM", to_uid: cited.iri, to_kind: null },
    ]);

    // An ordinary edit to the cited concept — a title, no status change. The relabel runs on
    // every commit, so what stops it flipping the citer is the deprecation test alone.
    await land(scenario, deltaOf(cited));
    expect(await edgesFrom(scenario, successor.iri)).toEqual([
      { label: "DERIVED_FROM", to_uid: cited.iri, to_kind: null },
    ]);

    await amend(cited.iri, { status: "deprecated" });
    await land(scenario, deltaOf(cited, { status: "deprecated" }));
    expect(await edgesFrom(scenario, successor.iri)).toEqual([
      { label: "SUPERSEDES", to_uid: cited.iri, to_kind: null },
    ]);
  });

  it("derives a derivation over a deprecated concept of another kind, never a succession", async () => {
    const scenario = await arrange();
    // ADR 0019's rule is both halves at once: deprecated **and** the citer's own kind. A
    // deprecated Product is not what a Policy succeeds.
    const retired = await conceptIn(scenario, {
      path: "knowledge/old-product.md",
      kind: "Product",
      status: "deprecated",
    });
    const policy = await conceptIn(scenario, {
      path: "knowledge/policy.md",
      kind: "Policy",
      frontmatter: { title: "Expenses", type: "Policy", sources: [{ resource: retired.iri }] },
    });
    await land(scenario, deltaOf(retired));

    await land(scenario, deltaOf(policy));

    expect(await edgesFrom(scenario, policy.iri)).toEqual([
      { label: "DERIVED_FROM", to_uid: retired.iri, to_kind: null },
    ]);
  });
});

type LinkFacts = {
  readonly to_uid: string;
  readonly section: string | null;
  readonly sentence: string | null;
};

const linksFrom = (scenario: MapScenario, fromUid: string): Promise<readonly LinkFacts[]> =>
  edgeRowsFrom<LinkFacts>(scenario, fromUid, "to_uid, section, sentence");

/** A concept whose body is the thing under test, at the bundle path every fixture links from. */
const authorOf = (scenario: MapScenario, body: string, path = "knowledge/policy.md") =>
  conceptIn(scenario, { path, kind: "Policy", body });

/**
 * One body, derived: the concepts it could reach, the author's own file, and the delta that
 * maps it. Every test below varies the markdown and the concepts around it and nothing else,
 * so this is their whole arrange and act — what each one *says* is the body it writes and the
 * edges it expects, which is the only part that differs.
 *
 * The first path is the concept a link is meant to land on and comes back as `target`; any
 * after it are decoys, seeded so that a mutation which wrongly resolved to one would have
 * somewhere to land rather than failing for want of a row.
 */
const derived = async (
  body: string,
  paths: readonly [string, ...string[]] = ["knowledge/product.md"],
): Promise<{ readonly target: IndexRow; readonly links: readonly LinkFacts[] }> => {
  const scenario = await arrange();
  const [wanted, ...decoys] = paths;
  const target = await conceptIn(scenario, { path: wanted, kind: "Product" });
  for (const path of decoys) await conceptIn(scenario, { path, kind: "Product" });
  const policy = await authorOf(scenario, body);
  await land(scenario, deltaOf(policy));
  return { target, links: await linksFrom(scenario, policy.iri) };
};

/** The uids a body linked to, for the tests whose whole claim is which concept it reached. */
const reached = (links: readonly LinkFacts[]): readonly string[] =>
  links.map((edge) => edge.to_uid);

/**
 * The derivation rule read off a file (ADR 0023, ADR 0026), through the delta rather than
 * through the parser: which markdown makes an edge, which target is a concept and which is
 * somebody else's resource, and what a made edge quotes of the file around it.
 */
describe("what a body's markdown makes an edge of", () => {
  it("quotes the sentence around the link, cut from its own paragraph at the terminators either side", async () => {
    const { target, links } = await derived(
      [
        "# Expenses",
        "",
        "Claims are checked weekly. See [the product](./product.md) for tiers. Receipts are kept for six years.",
        "",
        "A later paragraph names nothing at all.",
      ].join("\n"),
    );

    expect(links).toEqual([
      { to_uid: target.iri, section: "Expenses", sentence: "See the product for tiers." },
    ]);
  });

  it("reads a link in the file's first paragraph, which has no blank line above it", async () => {
    const { target, links } = await derived("See [the product](./product.md) for tiers.");

    expect(links).toEqual([
      { to_uid: target.iri, section: null, sentence: "See the product for tiers." },
    ]);
  });

  it("ends a sentence with no terminator at its own paragraph, never at the next one's", async () => {
    const { target, links } = await derived(
      "See [the product](./product.md) for tiers\n\nReceipts are kept for six years.",
    );

    expect(links).toEqual([
      { to_uid: target.iri, section: null, sentence: "See the product for tiers" },
    ]);
  });

  it("names the nearest heading above the link its section, at any level and trimmed", async () => {
    const { target, links } = await derived(
      [
        "# Expenses",
        "",
        "Intro text.",
        "",
        "### Tiers   ",
        "",
        "Costs sit under # 4 of the manual.",
        "",
        "See [the product](./product.md) for tiers.",
        "",
        "## Afterwards",
        "",
        "Nothing here.",
      ].join("\n"),
    );

    // The third-level heading above it — not the first-level one further up, not the
    // second-level one below it, and not the `#` sitting mid-line in the prose between.
    expect(links).toEqual([
      { to_uid: target.iri, section: "Tiers", sentence: "See the product for tiers." },
    ]);
  });

  it("derives nothing from a link inside quoted code, and keeps the prose around it where it was", async () => {
    const { target, links } = await derived(
      [
        "# Expenses",
        "",
        "```",
        "See [the decoy](./other.md) for nothing.",
        "```",
        "",
        "Use `[a decoy](./other.md)` sparingly. See [the product](./product.md) for tiers.",
      ].join("\n"),
      ["knowledge/product.md", "knowledge/other.md"],
    );

    // Code is quotation, not assertion: neither decoy makes an edge, and blanking them left
    // the one real link's own offsets alone, which is what the section and sentence read off.
    expect(links).toEqual([
      { to_uid: target.iri, section: "Expenses", sentence: "See the product for tiers." },
    ]);
  });

  it("closes a fence at its own closing line, and at no line that merely holds one", async () => {
    const { target, links } = await derived(
      [
        "# Expenses",
        "",
        "```",
        "```js still inside",
        "inline code is written ```",
        "See [the decoy](./other.md) for nothing.",
        "```   ",
        "See [the product](./product.md) for tiers.",
      ].join("\n"),
      ["knowledge/product.md", "knowledge/other.md"],
    );

    // A closing fence is a line of its own — its own character, at least the opener's
    // length, nothing but whitespace after it. A fence that closed early would make prose
    // of the decoy; one that never closed would swallow the real link below it.
    expect(links).toEqual([
      { to_uid: target.iri, section: "Expenses", sentence: "See the product for tiers." },
    ]);
  });

  it("leaves an unpaired backtick run as the literal text it is", async () => {
    const { target, links } = await derived(
      [
        "A ` stray tick is literal text.",
        "",
        "`` a quoted phrase `` and see [the product](./product.md) for tiers.",
        "",
        "Nothing more.",
      ].join("\n"),
    );

    // The pair closes, the stray tick does not, and a two-backtick run opening a line is a
    // span rather than a fence — so the quoted phrase leaves the sentence and nothing else does.
    expect(links).toEqual([
      { to_uid: target.iri, section: null, sentence: "and see the product for tiers." },
    ]);
  });

  it("takes a definition from a line of its own, however it spaces the colon, and from nowhere else", async () => {
    const { target, links } = await derived(
      [
        "Details in [tight] and nothing in [aside].",
        "",
        "The note reads [aside]: ./decoy.md in passing.",
        "",
        "[tight]:./product.md",
      ].join("\n"),
      ["knowledge/product.md", "knowledge/decoy.md"],
    );

    // `[tight]:./product.md` puts no space after its colon and still defines; the fragment
    // in the middle of a sentence puts one there and does not, because a definition is a
    // line of its own — so the shortcut `[aside]` above stays the plain text it looks like.
    expect(reached(links)).toEqual([target.iri]);
  });

  it("resolves a full reference through a definition whose label differs by case and spacing", async () => {
    const { target, links } = await derived(
      [
        "Details in [the product][  Price  Book  ].",
        "",
        "[pricebook]: ./other.md",
        "[price book]: <./product.md>",
        "[price book]: ./decoy.md",
      ].join("\n"),
      ["knowledge/product.md", "knowledge/other.md", "knowledge/decoy.md"],
    );

    // One label, four ways it could go wrong: padding around it, a neighbouring label that
    // differs only by a space, a second definition of the same label, and a bracketed target.
    expect(reached(links)).toEqual([target.iri]);
  });

  it("reads a collapsed reference as naming itself, and makes nothing of an empty target", async () => {
    const { target, links } = await derived(
      [
        "Collapsed: [price book][].",
        "",
        "Empty: [nothing]().",
        "",
        "[price book]: ./product.md",
      ].join("\n"),
    );

    expect(reached(links)).toEqual([target.iri]);
  });

  it("reads a colon inside a filename as part of the path, never as a scheme", async () => {
    // What makes a target external is a scheme **at its start**; a colon further along is a
    // character in a filename, and a concept named by one is still a concept.
    const { target, links } = await derived(
      "Hosted at [the vendor](//example.test/product), and detailed in [the annexe](./a:b.md).",
      ["knowledge/a:b.md"],
    );

    expect(reached(links)).toEqual([target.iri]);
  });

  it("makes one lineage edge per cited concept, and none for a citation that names no concept", async () => {
    const scenario = await arrange();
    const cited = await conceptIn(scenario, { path: "knowledge/expenses.md", kind: "Policy" });
    // An IRI nobody has minted a concept for: its edge is made anyway and dangles, which is
    // what makes a link to not-yet-written knowledge legal (`docs/okf-v02.md`).
    const unwritten = conceptIriOf(ulid());
    const successor = await conceptIn(scenario, {
      path: "knowledge/expenses-v2.md",
      kind: "Policy",
      frontmatter: {
        title: "Expenses v2",
        type: "Policy",
        sources: [
          { resource: cited.iri },
          { resource: cited.iri },
          { resource: unwritten },
          // Evidence from outside the bundle: a real citation, and no concept to point at.
          { resource: "https://example.test/hmrc-rates", locator: "4" },
        ],
      },
    });
    await land(scenario, deltaOf(cited));

    await land(scenario, deltaOf(successor));

    expect(
      (await edgesFrom(scenario, successor.iri)).map((edge) => edge.to_uid).toSorted(),
    ).toEqual([cited.iri, unwritten].toSorted());
  });

  it("backfills a link written before its target landed, at any depth in the bundle", async () => {
    const scenario = await arrange();
    const author = await authorOf(
      scenario,
      "See [the product](./deep/product.md) for tiers.",
      "knowledge/policy/author.md",
    );
    await land(scenario, deltaOf(author));
    expect(await linksFrom(scenario, author.iri)).toEqual([]);

    const product = await conceptIn(scenario, {
      path: "knowledge/policy/deep/product.md",
      kind: "Product",
    });
    await land(scenario, deltaOf(product));

    expect((await linksFrom(scenario, author.iri)).map((edge) => edge.to_uid)).toEqual([
      product.iri,
    ]);
  });
});
