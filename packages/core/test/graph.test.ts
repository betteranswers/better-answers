import { citedSourcesOf, conceptIriOf, ulid } from "@better-answers/schema";
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
import { answered, postgresForSuite, readingAs, seedingWith } from "./suite-postgres.ts";

const db = postgresForSuite();

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

const walked = async (
  reader: MapScenario["admin"],
  uid: string,
  direction: typeof walkFrom = walkFrom,
): Promise<readonly WalkStep[]> =>
  answered(
    await readingAs(db().runtimePool, reader, (principal, tx) => direction(principal, tx, uid)),
  );

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

    expect(uidsByDepth(steps)).toEqual(
      uids.slice(0, GRAPH_WALK_DEPTH + 1).map((uid, depth) => [uid, depth]),
    );
  });

  const WITHHELD: readonly (readonly [
    string,
    { readonly node?: object; readonly edge?: object; readonly adminSees: boolean },
  ])[] = [
    ["a Restricted middle concept", { node: { sensitivity: "Restricted" }, adminSees: true }],
    ["a Restricted middle edge", { edge: { sensitivity: "Restricted" }, adminSees: true }],

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

      await seed.graphEdge({
        workspaceId: ours.workspaceId,
        fromUid: mine.uid,
        toUid: to.uid,
      });
      return { home: mine.uid, theirEntry: from.uid, theirFar: to.uid };
    });

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

    const inbound = await walked(scenario.viewer, entry, walkTo);
    expect(inbound.map((step) => step.uid).toSorted()).toEqual([entry, entity].toSorted());

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

    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(Object.keys(step).toSorted()).toEqual(["depth", "kind", "label", "path", "uid"]);
    }
  });
});

type IndexRow = Awaited<ReturnType<TestData["conceptIndex"]>>;

const conceptIn = (scenario: MapScenario, overrides: Partial<IndexRow>): Promise<IndexRow> =>
  seeded((seed) => seed.conceptIndex({ workspaceId: scenario.workspaceId, ...overrides }));

const deltaOf = (row: IndexRow, overrides: Partial<ConceptDelta> = {}): ConceptDelta => {
  if (row.frontmatter === null) throw new Error("the seeded concept carries no frontmatter");
  return {
    workspaceId: row.workspaceId,
    iri: row.iri,
    kind: row.kind,
    path: row.path,
    body: row.body,
    sources: citedSourcesOf(row.frontmatter["sources"]),
    publishedAt: row.publishedAt,
    sensitivity: row.sensitivity,
    audience: row.audience,
    audienceGroups: row.audienceGroups,
    status: row.status,
    ...overrides,
  };
};

const land = async (scenario: MapScenario, delta: ConceptDelta): Promise<void> =>
  answered(
    await readingAs(db().runtimePool, scenario.admin, (principal, tx) =>
      writeConceptDelta(principal, tx, delta),
    ),
  );

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

    // The target lands first: a newly mapped concept re-derives every file naming it, which
    // would carry the new kind whether or not the sync ran.
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

const authorOf = (scenario: MapScenario, body: string, path = "knowledge/policy.md") =>
  conceptIn(scenario, { path, kind: "Policy", body });

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

const reached = (links: readonly LinkFacts[]): readonly string[] =>
  links.map((edge) => edge.to_uid);

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

    expect(links).toEqual([
      { to_uid: target.iri, section: null, sentence: "and see the product for tiers." },
    ]);
  });

  it("never closes a run with one of another length, so a link between the two stays prose", async () => {
    const { target, links } = await derived("See ``[the product](./product.md)` for tiers.");

    expect(links).toEqual([
      { to_uid: target.iri, section: null, sentence: "See ``the product` for tiers." },
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
    const { target, links } = await derived(
      "Hosted at [the vendor](//example.test/product), and detailed in [the annexe](./a:b.md).",
      ["knowledge/a:b.md"],
    );

    expect(reached(links)).toEqual([target.iri]);
  });

  it("makes one lineage edge per cited concept, and none for a citation that names no concept", async () => {
    const scenario = await arrange();
    const cited = await conceptIn(scenario, { path: "knowledge/expenses.md", kind: "Policy" });

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
