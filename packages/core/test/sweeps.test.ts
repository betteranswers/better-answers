import { ulid } from "@better-answers/schema";
import { describe, expect, it } from "vitest";

import { SWEEPS, sweepEveryWorkspace, withSweepLock } from "@better-answers/core/sweeps";

import { listObjects, putObject } from "../src/store/objects/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { principalOf, provisionedWorkspace } from "./platform.ts";
import { objectStoreForSuite } from "./suite-objects.ts";
import {
  countWaitingOnLocks,
  postgresForEachCase,
  seedingWith,
  until,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const store = objectStoreForSuite();
const db = postgresForEachCase();

const A_DAY_ON = (): Date => new Date(Date.now() + 25 * 60 * 60 * 1000);

const doors = () => ({
  postgres: openPostgres(db().runtimePool),
  objects: store().door,
  clock: { now: A_DAY_ON },
});

const workspaceWithLeftovers = async (name: string) => {
  const workspace = await provisionedWorkspace(db(), name);
  const admin = principalOf(workspace.workspaceId, workspace.adminUserId, "Admin");
  const orphan = `uploads/${ulid().toLowerCase()}/original`;
  const put = await putObject(
    admin,
    store().door,
    orphan,
    new Blob(["The bytes of a bind whose row never landed."]).stream(),
  );
  if (!put.ok) throw new Error(`the orphan was refused: ${put.error}`);
  await seedingWith(db().pool, async (seed) => {
    const live = await seed.graphNode({ workspaceId: workspace.workspaceId });
    await seed.graphEdge({ workspaceId: workspace.workspaceId, fromUid: live.uid });
    const left = await seed.graphNode({ workspaceId: workspace.workspaceId, gen: 2 });
    await seed.graphEdge({ workspaceId: workspace.workspaceId, gen: 2, fromUid: left.uid });
  });
  return { ...workspace, admin, orphan };
};

const generationsOf = async (workspaceId: string): Promise<readonly number[]> => {
  const found = await db().pool.query<{ gen: number }>(
    "SELECT DISTINCT gen FROM graph_node WHERE workspace_id = $1 AND gen IS NOT NULL ORDER BY gen",
    [workspaceId],
  );
  return found.rows.map((row) => row.gen);
};

const storedIn = async (workspace: { readonly admin: ReturnType<typeof principalOf> }) =>
  listObjects(workspace.admin, store().door, "");

const passesRecorded = async () => {
  const recorded = await db().pool.query(
    `SELECT id, upload_sweep, workspaces, refused, found, removed, generations, at <= now() AS stamped
       FROM sweep_pass ORDER BY at, id`,
  );
  return recorded.rows;
};

const A_PASS_ID = expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/);

describe("a sweep pass over every workspace", () => {
  it("removes each workspace's orphaned uploads past the grace and its map's leftovers, and totals them", async () => {
    const first = await workspaceWithLeftovers("First");
    const second = await workspaceWithLeftovers("Second");
    await provisionedWorkspace(db(), "Clean");

    const pass = await sweepEveryWorkspace(SWEEPS, doors(), { uploadSweep: "remove" });

    expect(pass.ok).toBe(true);
    if (!pass.ok) return;
    expect(pass.value.uploadSweep).toBe("remove");
    expect(pass.value.totals).toEqual({
      workspaces: 3,
      refused: 0,
      found: 2,
      removed: 2,
      generations: 2,
    });
    expect(await storedIn(first)).toEqual({ ok: true, value: [] });
    expect(await storedIn(second)).toEqual({ ok: true, value: [] });
    expect(await generationsOf(first.workspaceId)).toEqual([1]);
    expect(await generationsOf(second.workspaceId)).toEqual([1]);
    expect(await passesRecorded()).toEqual([
      {
        id: A_PASS_ID,
        upload_sweep: "remove",
        workspaces: 3,
        refused: 0,
        found: 2,
        removed: 2,
        generations: 2,
        stamped: true,
      },
    ]);
  });

  it("counts the orphaned uploads and removes none when it is list-only, while the map's leftovers still go", async () => {
    const workspace = await workspaceWithLeftovers("Listed");

    const pass = await sweepEveryWorkspace(SWEEPS, doors(), { uploadSweep: "list" });

    expect(pass.ok).toBe(true);
    if (!pass.ok) return;
    expect(pass.value.uploadSweep).toBe("list");
    expect(pass.value.totals).toEqual({
      workspaces: 1,
      refused: 0,
      found: 1,
      removed: 0,
      generations: 1,
    });
    expect(await storedIn(workspace)).toEqual({ ok: true, value: [workspace.orphan] });
    expect(await generationsOf(workspace.workspaceId)).toEqual([1]);
  });

  it("goes on past a workspace whose sweep is refused, and names the one it could not sweep", async () => {
    const stuck = await workspaceWithLeftovers("Stuck");
    const orphaned = await provisionedWorkspace(db(), "Orphaned");
    const orphan = `uploads/${ulid().toLowerCase()}/original`;
    const admin = principalOf(orphaned.workspaceId, orphaned.adminUserId, "Admin");
    await putObject(admin, store().door, orphan, new Blob(["Left by a failed bind."]).stream());

    const pass = await whileWritesAreRefused(db().pool, "graph_node", () =>
      sweepEveryWorkspace(SWEEPS, doors(), { uploadSweep: "remove" }),
    );

    expect(await generationsOf(stuck.workspaceId)).toEqual([1, 2]);
    expect(await listObjects(admin, store().door, "")).toEqual({ ok: true, value: [] });
    expect(pass.ok).toBe(true);
    if (!pass.ok) return;
    expect(pass.value.totals).toEqual({
      workspaces: 2,
      refused: 1,
      found: 2,
      removed: 2,
      generations: 0,
    });
    const refused = pass.value.swept.filter((swept) => !swept.graph.ok);
    expect(refused.map((swept) => swept.workspaceId)).toEqual([stuck.workspaceId]);
    expect(await passesRecorded()).toEqual([
      {
        id: A_PASS_ID,
        upload_sweep: "remove",
        workspaces: 2,
        refused: 1,
        found: 2,
        removed: 2,
        generations: 0,
        stamped: true,
      },
    ]);
  });

  it("answers a failure when its row cannot be written, the sweeping done", async () => {
    const workspace = await workspaceWithLeftovers("Unrecorded");

    const pass = await whileWritesAreRefused(db().pool, "sweep_pass", () =>
      sweepEveryWorkspace(SWEEPS, doors(), { uploadSweep: "remove" }),
    );

    expect(pass.ok).toBe(false);
    expect(await passesRecorded()).toEqual([]);
    expect(await storedIn(workspace)).toEqual({ ok: true, value: [] });
  });

  it("finds nothing to do over workspaces with nothing left behind, and still leaves its row", async () => {
    await provisionedWorkspace(db(), "Tidy");

    const pass = await sweepEveryWorkspace(SWEEPS, doors(), { uploadSweep: "remove" });

    expect(await passesRecorded()).toEqual([
      {
        id: A_PASS_ID,
        upload_sweep: "remove",
        workspaces: 1,
        refused: 0,
        found: 0,
        removed: 0,
        generations: 0,
        stamped: true,
      },
    ]);
    expect(pass).toEqual({
      ok: true,
      value: {
        uploadSweep: "remove",
        totals: { workspaces: 1, refused: 0, found: 0, removed: 0, generations: 0 },
        swept: [
          {
            workspaceId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
            uploads: { ok: true, value: { found: 0, removed: 0 } },
            graph: { ok: true, value: [] },
          },
        ],
      },
    });
  });
});

describe("a sweep pass while another holder has the sweeps' lock", () => {
  it("is skipped, and removes nothing from any store", async () => {
    const workspace = await workspaceWithLeftovers("Held");

    const pass = await withSweepLock(SWEEPS, doors().postgres, () =>
      sweepEveryWorkspace(SWEEPS, doors(), { uploadSweep: "remove" }),
    );

    expect(pass).toEqual({ ok: false, error: "held" });
    expect(await listObjects(workspace.admin, store().door, "")).toEqual({
      ok: true,
      value: [workspace.orphan],
    });
    expect(await generationsOf(workspace.workspaceId)).toEqual([1, 2]);
    expect(await passesRecorded()).toEqual([]);
  });

  it("runs once the holder lets go", async () => {
    const workspace = await workspaceWithLeftovers("Released");
    await withSweepLock(SWEEPS, doors().postgres, async () => undefined);

    const pass = await sweepEveryWorkspace(SWEEPS, doors(), { uploadSweep: "remove" });

    expect(pass.ok).toBe(true);
    expect(await storedIn(workspace)).toEqual({ ok: true, value: [] });
  });
});

describe("a sweep by hand", () => {
  it("waits while another holder has the sweeps' lock, and runs when it lets go", async () => {
    const order: string[] = [];
    let letGo = (): void => undefined;
    const holding = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const first = withSweepLock(SWEEPS, doors().postgres, async () => {
      order.push("first in");
      await holding;
      order.push("first out");
    });
    await until(async () => order.includes("first in"));

    const second = withSweepLock(SWEEPS, doors().postgres, async () => {
      order.push("second in");
    });
    await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
    expect(order).toEqual(["first in"]);

    letGo();
    await Promise.all([first, second]);

    expect(order).toEqual(["first in", "first out", "second in"]);
  });
});
