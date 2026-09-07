import { testData, type TestData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import {
  GRAPH_WALK_DEPTH,
  GRAPH_WALK_ROW_LIMIT,
  walkFrom,
  walkTo,
  type WalkStep,
} from "@better-answers/core/store/graph";
import { postgresForSuite, readingAs } from "./suite-postgres.ts";

/**
 * The traversal templates through the graph door (`[TEST1]`), over factory-seeded rows on
 * real Postgres: depth capped at 4 by the template, the read predicate applied on **every
 * element of every path** — a path with one withheld element is no path — the live
 * generation bound on every step, and never another workspace's rows, whoever asks
 * (`[SEC3]`: what a walk refuses is the claim, not what it returns).
 */

const db = postgresForSuite();

/** A workspace with an Admin and a Viewer, and its factory — the arrange every walk needs. */
type MapScenario = {
  readonly workspaceId: string;
  readonly admin: { readonly workspaceId: string; readonly userId: string };
  readonly viewer: { readonly workspaceId: string; readonly userId: string };
};

const seeded = async <T>(work: (seed: TestData) => Promise<T>): Promise<T> => {
  const client = await db().pool.connect();
  try {
    return await work(testData(client));
  } finally {
    client.release();
  }
};

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
