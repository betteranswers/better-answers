import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import {
  MAP_WALK_DEPTH,
  walkFrom,
  walkFromEntries,
  walkTo,
  walkToEntries,
  writeConceptDelta,
  type ConceptDelta,
  type WalkStep,
} from "@better-answers/core/store/map";
import { citedSourcesOf, conceptIriOf, ids, ulid } from "@better-answers/schema";
import type { TestData } from "@better-answers/schema/testing";

import {
  answered,
  holdingTable,
  postgresForSuite,
  readingAs,
  seedingWith,
} from "./suite-postgres.ts";

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
    await readingAs(db().runtimePool, reader, (principal, tx) =>
      direction(principal, tx, ids.conceptIri.parse(uid)),
    ),
  );

const walkedFromEntries = async (
  reader: MapScenario["admin"],
  uids: readonly string[],
): Promise<readonly WalkStep[]> =>
  answered(
    await readingAs(db().runtimePool, reader, (principal, tx) =>
      walkFromEntries(
        principal,
        tx,
        uids.map((uid) => ids.conceptIri.parse(uid)),
      ),
    ),
  );

const uidsByDepth = (steps: readonly WalkStep[]): readonly (readonly [string, number])[] =>
  steps.map((step) => [step.uid, step.depth]);

/** A hub one hop from 1,001 spokes, more than the row limit holds. */
const starIn = async (
  scenario: MapScenario,
): Promise<{ readonly hub: string; readonly spokes: readonly string[] }> => {
  const star = await seeded(async (seed) => {
    const hub = await seed.mapNode({ workspaceId: scenario.workspaceId });
    const spokes = Array.from({ length: 1_001 }, () => conceptIriOf(ulid())).toSorted();
    // Greatest uid first, so a cut taken in the order rows are met keeps the wrong spokes.
    for (const uid of spokes.toReversed()) {
      await seed.mapNode({ workspaceId: scenario.workspaceId, uid });
      await seed.mapEdge({ workspaceId: scenario.workspaceId, fromUid: hub.uid, toUid: uid });
    }
    return { hub: hub.uid, spokes };
  });
  // Autovacuum counts a live map's rows; uncounted, the planner joins every node to every step.
  await db().pool.query("ANALYZE map_node, map_edge");
  return star;
};

describe("a map walk", () => {
  it("reaches everything within four hops of the entry, no further", async () => {
    const scenario = await arrange();
    const uids = await seeded(async (seed) => {
      const chain: string[] = [];
      for (let at = 0; at <= MAP_WALK_DEPTH + 1; at += 1) {
        const node = await seed.mapNode({ workspaceId: scenario.workspaceId });
        const previous = chain.at(-1);
        if (previous !== undefined) {
          await seed.mapEdge({
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
      uids.slice(0, MAP_WALK_DEPTH + 1).map((uid, depth) => [uid, depth]),
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

  it.each(WITHHELD)("excludes every path through %s", async (_what, shape) => {
    const scenario = await arrange();
    const { entry, middle, far } = await seeded(async (seed) => {
      const a = await seed.mapNode({ workspaceId: scenario.workspaceId });
      const b = await seed.mapNode({ workspaceId: scenario.workspaceId, ...shape.node });
      const c = await seed.mapNode({ workspaceId: scenario.workspaceId });
      await seed.mapEdge({
        workspaceId: scenario.workspaceId,
        fromUid: a.uid,
        toUid: b.uid,
        ...shape.edge,
      });
      await seed.mapEdge({ workspaceId: scenario.workspaceId, fromUid: b.uid, toUid: c.uid });
      return { entry: a.uid, middle: b.uid, far: c.uid };
    });

    const viewer = await walked(scenario.viewer, entry);
    expect(uidsByDepth(viewer)).toEqual([[entry, 0]]);

    const admin = await walked(scenario.admin, entry);
    expect(admin.map((step) => step.uid).includes(far)).toBe(shape.adminSees);
    expect(admin.map((step) => step.uid).includes(middle)).toBe(shape.adminSees);
  });

  it("answers a withheld entry exactly as one nobody mapped", async () => {
    const scenario = await arrange();
    const restricted = await seeded((seed) =>
      seed.mapNode({ workspaceId: scenario.workspaceId, sensitivity: "Restricted" }),
    );

    const withheld = await walked(scenario.viewer, restricted.uid);
    const absent = await walked(
      scenario.viewer,
      "https://better-answers.com/c/01J6ZZZZZZZZZZZZZZZZZZZZZZ",
    );

    expect(withheld).toEqual([]);
    expect(absent).toEqual([]);
  });

  it("never crosses workspaces, even through an edge naming another's node", async () => {
    const ours = await arrange();
    const theirs = await arrange();
    const { home, theirEntry, theirFar } = await seeded(async (seed) => {
      const mine = await seed.mapNode({ workspaceId: ours.workspaceId });
      const from = await seed.mapNode({ workspaceId: theirs.workspaceId });
      const to = await seed.mapNode({ workspaceId: theirs.workspaceId });
      await seed.mapEdge({
        workspaceId: theirs.workspaceId,
        fromUid: from.uid,
        toUid: to.uid,
      });

      await seed.mapEdge({
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

  it("walks only the live generation, with source entities beside it", async () => {
    const scenario = await arrange();
    const { entry, liveFar, nextFar, entity } = await seeded(async (seed) => {
      const a = await seed.mapNode({ workspaceId: scenario.workspaceId });
      const b = await seed.mapNode({ workspaceId: scenario.workspaceId });
      await seed.mapEdge({ workspaceId: scenario.workspaceId, fromUid: a.uid, toUid: b.uid });
      const person = await seed.mapNode({
        workspaceId: scenario.workspaceId,
        gen: null,
        label: "source-entity:Person",
        kind: null,
      });
      await seed.mapEdge({
        workspaceId: scenario.workspaceId,
        gen: null,
        label: "IS_CONCEPT",
        fromUid: person.uid,
        toUid: a.uid,
        uid: `is_concept:${person.uid}`,
      });

      const rebuiltEntry = await seed.mapNode({
        workspaceId: scenario.workspaceId,
        gen: 2,
        uid: a.uid,
      });
      const c = await seed.mapNode({ workspaceId: scenario.workspaceId, gen: 2 });
      await seed.mapEdge({
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

    await db().pool.query("UPDATE map_generation SET live_gen = 2 WHERE workspace_id = $1", [
      scenario.workspaceId,
    ]);

    const after = await walked(scenario.viewer, entry);
    expect(after.map((step) => step.uid).toSorted()).toEqual([entry, nextFar].toSorted());
    expect(after.map((step) => step.uid)).not.toContain(liveFar);
  });

  it("answers a node's fields alone, nothing off an edge", async () => {
    const scenario = await arrange();
    const entry = await seeded(async (seed) => {
      const a = await seed.mapNode({ workspaceId: scenario.workspaceId });
      await seed.mapEdge({ workspaceId: scenario.workspaceId, fromUid: a.uid });
      return a.uid;
    });

    const steps = await walked(scenario.admin, entry);

    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(Object.keys(step).toSorted()).toEqual(["depth", "kind", "label", "uid"]);
    }
  });

  it("fails past its timeout, and the next transaction answers", async () => {
    const scenario = await arrange();
    const entry = await seeded((seed) => seed.mapNode({ workspaceId: scenario.workspaceId }));

    await expect(
      holdingTable(db().pool, "map_node", () => walked(scenario.viewer, entry.uid)),
    ).rejects.toMatchObject({ code: "57014" });

    expect(uidsByDepth(await walked(scenario.viewer, entry.uid))).toEqual([[entry.uid, 0]]);
  });
});

describe("a map walk from several entries", () => {
  it("reaches what its entries reach, each node at least depth", async () => {
    const scenario = await arrange();
    const { a, b, c, d, e } = await seeded(async (seed) => {
      const node = async (): Promise<string> =>
        (await seed.mapNode({ workspaceId: scenario.workspaceId })).uid;
      const made = {
        a: await node(),
        b: await node(),
        c: await node(),
        d: await node(),
        e: await node(),
      };
      for (const [fromUid, toUid] of [
        [made.a, made.b],
        [made.b, made.c],
        [made.c, made.d],
        [made.e, made.c],
        [made.c, made.a],
      ] as const) {
        await seed.mapEdge({ workspaceId: scenario.workspaceId, fromUid, toUid });
      }
      return made;
    });

    const steps = await walkedFromEntries(scenario.viewer, [a, e]);

    expect(uidsByDepth(steps)).toEqual([
      ...[a, e].toSorted().map((uid) => [uid, 0]),
      ...[b, c].toSorted().map((uid) => [uid, 1]),
      [d, 2],
    ]);
  });

  it("cuts past the cap by depth then uid, every run", async () => {
    const scenario = await arrange();
    const { hub, spokes } = await starIn(scenario);
    const lone = await seeded((seed) => seed.mapNode({ workspaceId: scenario.workspaceId }));

    const first = await walkedFromEntries(scenario.viewer, [lone.uid, hub]);
    const second = await walkedFromEntries(scenario.viewer, [lone.uid, hub]);

    expect(uidsByDepth(first)).toEqual([
      ...[hub, lone.uid].toSorted().map((uid) => [uid, 0]),
      ...spokes.slice(0, 998).map((uid) => [uid, 1]),
    ]);
    expect(second).toEqual(first);
  });

  it("spends none of the cap on a withheld entry", async () => {
    const scenario = await arrange();
    const { hub, spokes } = await starIn(scenario);
    const withheld = await seeded(async (seed) => {
      const restricted = await seed.mapNode({
        workspaceId: scenario.workspaceId,
        sensitivity: "Restricted",
      });
      // The least uid there is: were the withheld entry walked from, this would lead depth one.
      const behind = await seed.mapNode({
        workspaceId: scenario.workspaceId,
        uid: conceptIriOf("00000000000000000000000000"),
      });
      await seed.mapEdge({
        workspaceId: scenario.workspaceId,
        fromUid: restricted.uid,
        toUid: behind.uid,
      });
      return restricted.uid;
    });

    const viewer = await walkedFromEntries(scenario.viewer, [withheld, hub]);

    expect(uidsByDepth(viewer)).toEqual([[hub, 0], ...spokes.slice(0, 999).map((uid) => [uid, 1])]);
    expect(viewer).toEqual(await walkedFromEntries(scenario.viewer, [hub]));

    const admin = await walkedFromEntries(scenario.admin, [withheld, hub]);
    expect(uidsByDepth(admin)).toContainEqual([withheld, 0]);
  });

  it("cuts every entry's path through a withheld node", async () => {
    const scenario = await arrange();
    const { entries, middle, far } = await seeded(async (seed) => {
      const a = await seed.mapNode({ workspaceId: scenario.workspaceId });
      const b = await seed.mapNode({ workspaceId: scenario.workspaceId });
      const restricted = await seed.mapNode({
        workspaceId: scenario.workspaceId,
        sensitivity: "Restricted",
      });
      const c = await seed.mapNode({ workspaceId: scenario.workspaceId });
      for (const [fromUid, toUid] of [
        [a.uid, restricted.uid],
        [b.uid, restricted.uid],
        [restricted.uid, c.uid],
      ] as const) {
        await seed.mapEdge({ workspaceId: scenario.workspaceId, fromUid, toUid });
      }
      return { entries: [a.uid, b.uid].toSorted(), middle: restricted.uid, far: c.uid };
    });

    const viewer = await walkedFromEntries(scenario.viewer, entries);
    expect(uidsByDepth(viewer)).toEqual(entries.map((uid) => [uid, 0]));

    const admin = await walkedFromEntries(scenario.admin, entries);
    expect(uidsByDepth(admin)).toEqual([...entries.map((uid) => [uid, 0]), [middle, 1], [far, 2]]);
  });

  it("reaches a node inward at its least depth", async () => {
    const scenario = await arrange();
    const { near, far, between, source } = await seeded(async (seed) => {
      const node = async (): Promise<string> =>
        (await seed.mapNode({ workspaceId: scenario.workspaceId })).uid;
      const made = { near: await node(), far: await node(), between: await node() };
      const leading = await node();
      for (const [fromUid, toUid] of [
        [leading, made.near],
        [leading, made.between],
        [made.between, made.far],
      ] as const) {
        await seed.mapEdge({ workspaceId: scenario.workspaceId, fromUid, toUid });
      }
      return { ...made, source: leading };
    });

    const steps = answered(
      await readingAs(db().runtimePool, scenario.viewer, (principal, tx) =>
        walkToEntries(principal, tx, [near, far]),
      ),
    );

    expect(uidsByDepth(steps)).toEqual([
      ...[near, far].toSorted().map((uid) => [uid, 0]),
      ...[between, source].toSorted().map((uid) => [uid, 1]),
    ]);
  });
});

/** A concept's index row under `collection`, or under none, with its node on the map. */
const conceptNode = async (
  seed: TestData,
  workspaceId: string,
  collection: string | null,
  iri: string = conceptIriOf(ulid()),
): Promise<string> => {
  await seed.conceptIdentity({ workspaceId, iri });
  const folder = collection === null ? "" : `${collection}/`;
  await seed.conceptIndex({
    workspaceId,
    iri,
    path: `knowledge/${folder}${ulid().toLowerCase()}.md`,
  });
  await seed.mapNode({ workspaceId, uid: iri });
  return iri;
};

const walkedInside = async (
  reader: MapScenario["admin"],
  uids: readonly string[],
  collections: readonly string[],
): Promise<readonly WalkStep[]> =>
  answered(
    await readingAs(db().runtimePool, reader, (principal, tx) =>
      walkFromEntries(
        principal,
        tx,
        uids.map((uid) => ids.conceptIri.parse(uid)),
        collections,
      ),
    ),
  );

describe("a map walk narrowed to collections", () => {
  it("keeps a collection's neighbours past a hub's thousand others", async () => {
    const scenario = await arrange();
    const workspaceId = scenario.workspaceId;
    const { hub, inside } = await seeded(async (seed) => {
      const centre = await conceptNode(seed, workspaceId, "audits");
      const uids = Array.from({ length: 1_003 }, () => conceptIriOf(ulid())).toSorted();
      // The two greatest uids are the hub's own collection: a cut taken first drops exactly them.
      for (const [at, uid] of uids.entries()) {
        await conceptNode(seed, workspaceId, at < 1_001 ? "lms" : "audits", uid);
        await seed.mapEdge({ workspaceId, fromUid: centre, toUid: uid });
      }
      return { hub: centre, inside: uids.slice(1_001) };
    });
    await db().pool.query("ANALYZE map_node, map_edge");

    const narrowed = await walkedInside(scenario.viewer, [hub], ["audits"]);
    const whole = await walkedFromEntries(scenario.viewer, [hub]);

    expect(uidsByDepth(narrowed)).toEqual([[hub, 0], ...inside.map((uid) => [uid, 1])]);
    expect(whole).toHaveLength(1_000);
    expect(whole.map((step) => step.uid)).not.toContain(inside[0]);
  });

  it("never leaves a named collection and comes back", async () => {
    const scenario = await arrange();
    const workspaceId = scenario.workspaceId;
    const { entry, outside, beyond, unfiled } = await seeded(async (seed) => {
      const made = {
        entry: await conceptNode(seed, workspaceId, "audits"),
        outside: await conceptNode(seed, workspaceId, "lms"),
        beyond: await conceptNode(seed, workspaceId, "audits"),
        unfiled: await conceptNode(seed, workspaceId, null),
      };
      for (const [fromUid, toUid] of [
        [made.entry, made.outside],
        [made.outside, made.beyond],
        [made.entry, made.unfiled],
      ] as const) {
        await seed.mapEdge({ workspaceId, fromUid, toUid });
      }
      return made;
    });

    const narrowed = await walkedInside(scenario.viewer, [entry, outside], ["audits"]);
    const whole = await walkedFromEntries(scenario.viewer, [entry]);

    expect(uidsByDepth(narrowed)).toEqual([[entry, 0]]);
    expect(whole.map((step) => step.uid).toSorted()).toEqual(
      [entry, outside, beyond, unfiled].toSorted(),
    );
  });

  it("passes through a node that is no concept", async () => {
    const scenario = await arrange();
    const workspaceId = scenario.workspaceId;
    const { entry, section, beyond } = await seeded(async (seed) => {
      const made = {
        entry: await conceptNode(seed, workspaceId, "audits"),
        section: (await seed.mapNode({ workspaceId, label: "Section", kind: null })).uid,
        beyond: await conceptNode(seed, workspaceId, "audits"),
      };
      await seed.mapEdge({ workspaceId, fromUid: made.entry, toUid: made.section });
      await seed.mapEdge({ workspaceId, fromUid: made.section, toUid: made.beyond });
      return made;
    });

    const narrowed = await walkedInside(scenario.viewer, [entry], ["audits"]);
    const whole = await walkedFromEntries(scenario.viewer, [entry]);

    expect(uidsByDepth(narrowed)).toEqual([
      [entry, 0],
      [beyond, 2],
    ]);
    expect(uidsByDepth(whole)).toContainEqual([section, 1]);
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
    `SELECT ${columns} FROM map_edge WHERE workspace_id = $1 AND from_uid = $2 ORDER BY uid`,
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
  it("takes a link the edit removed off the map", async () => {
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

  it("moves an inbound link's denormalised kind with its target's kind", async () => {
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

  it("leaves a citer's lineage alone until the cited concept's deprecation", async () => {
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

  it("derives from a deprecated concept of another kind, never supersedes", async () => {
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
  it("quotes the link's sentence, cut at the terminators either side", async () => {
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

  it("reads a link in the file's first paragraph", async () => {
    const { target, links } = await derived("See [the product](./product.md) for tiers.");

    expect(links).toEqual([
      { to_uid: target.iri, section: null, sentence: "See the product for tiers." },
    ]);
  });

  it("ends an unterminated sentence at its own paragraph's end", async () => {
    const { target, links } = await derived(
      "See [the product](./product.md) for tiers\n\nReceipts are kept for six years.",
    );

    expect(links).toEqual([
      { to_uid: target.iri, section: null, sentence: "See the product for tiers" },
    ]);
  });

  it("takes the nearest heading, any level, trimmed, as its section", async () => {
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

  it("derives nothing from quoted code, keeping the prose around it", async () => {
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

  it("closes a fence only at its own closing line", async () => {
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

  it("leaves an unpaired backtick run as literal text", async () => {
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

  it("closes a backtick run only with one of its length", async () => {
    const { target, links } = await derived("See ``[the product](./product.md)` for tiers.");

    expect(links).toEqual([
      { to_uid: target.iri, section: null, sentence: "See ``the product` for tiers." },
    ]);
  });

  it("takes a definition only from its own line, however spaced", async () => {
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

  it("resolves a full reference's label ignoring case and extra spacing", async () => {
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

  it("resolves a collapsed reference via its label, skipping empty targets", async () => {
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

  it("reads a filename's colon as path, never a scheme", async () => {
    const { target, links } = await derived(
      "Hosted at [the vendor](//example.test/product), and detailed in [the annexe](./a:b.md).",
      ["knowledge/a:b.md"],
    );

    expect(reached(links)).toEqual([target.iri]);
  });

  it("makes one lineage edge per cited concept, none for others", async () => {
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

  it("backfills a link written before its target landed, however deep", async () => {
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
