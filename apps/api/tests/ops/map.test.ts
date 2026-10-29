import { describe, expect, it } from "vitest";

import { openPostgres } from "@better-answers/core/store/postgres";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { countWaitingOnLocks, until } from "@better-answers/core/testing/postgres";
import { testData } from "@better-answers/schema/testing";
import { matching } from "@better-answers/schema/testing/matching";

import type { TestApp } from "../support/harness/harness.ts";
import { opsRunner, type Run, jobsOf } from "../support/ops-run.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { ops } = opsRunner(objects);

const mapped = async (app: TestApp, workspaceId: string): Promise<void> => {
  const client = await app.database.superuser.connect();
  try {
    const seed = testData(client);
    const entry = await seed.mapNode({ workspaceId });
    await seed.mapEdge({ workspaceId, fromUid: entry.uid });
    const left = await seed.mapNode({ workspaceId, gen: 2 });
    await seed.mapEdge({ workspaceId, gen: 2, fromUid: left.uid });
    await seed.mapUnresolvedReference({ workspaceId, gen: 2, fromUid: left.uid });
  } finally {
    client.release();
  }
};

const answered = (run: Run): unknown => JSON.parse(run.lines[0] ?? "");

const finishTheJob = async (app: TestApp, workspaceId: string, status: string): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const moved = await app.database.superuser.query(
      `UPDATE job SET status = $2, finished_at = now(),
              outcome = CASE WHEN $2 IN ('done', 'failed') THEN '{"generation": 2}'::jsonb END
        WHERE workspace_id = $1 AND status = 'queued'`,
      [workspaceId, status],
    );
    if ((moved.rowCount ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`nothing was ever queued in ${workspaceId}`);
};

describe("pnpm ops — the restore scripts' commands", () => {
  const served = servedApp();

  describe("map-rebuild — the map made again, on the worker's queue", () => {
    it("queues a drill's full rebuild and answers the job's id", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), ["map-rebuild", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      const queued = await jobsOf(served(), workspaceId);

      expect(queued).toEqual([
        { id: matching.any(String), kind: "full-rebuild", reason: "drill", status: "queued" },
      ]);
      expect(run.lines).toEqual([`map-rebuild: done — enqueued ${queued[0]?.id}`]);
    });

    it("takes the caller's reason from among the six", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), [
        "map-rebuild",
        "--workspace",
        workspaceId,
        "--reason",
        "upgrade",
      ]);

      expect(run.exitCode).toBe(0);
      expect((await jobsOf(served(), workspaceId))[0]?.reason).toBe("upgrade");
    });

    it("answers usage to a reason outside the six, queueing nothing", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), [
        "map-rebuild",
        "--workspace",
        workspaceId,
        "--reason",
        "because-i-said-so",
      ]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "map-rebuild: --reason must be one of first-build, model-choice-change, reconciler, erasure, upgrade, drill",
      ]);
      expect(await jobsOf(served(), workspaceId)).toEqual([]);
    });

    it("refuses a non-id workspace as malformed, naming its flag", async () => {
      const run = await ops(served(), ["map-rebuild", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "map-rebuild: REFUSED — malformed: --workspace ws_synthetic is not a workspace id",
      ]);
    });

    it("waits two minutes by default, as its usage says", async () => {
      const run = await ops(served(), ["help"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain(
        "--wait    poll the job until it is over, 120 seconds",
      );
      expect(run.lines.join("\n")).toContain("--wait-seconds <n>");
    });

    it("waits for its job, done once the worker finishes it", async () => {
      const { workspaceId } = await served().provision();

      const waiting = ops(served(), ["map-rebuild", "--workspace", workspaceId, "--wait"]);
      await finishTheJob(served(), workspaceId, "done");
      const run = await waiting;

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("rebuilt the map");
    });

    it.each(["failed", "poisoned"])(
      "refuses, stopping the restore, when the awaited job is %s",
      async (status) => {
        const { workspaceId } = await served().provision();

        const waiting = ops(served(), ["map-rebuild", "--workspace", workspaceId, "--wait"]);
        await finishTheJob(served(), workspaceId, status);
        const run = await waiting;

        expect(run.exitCode).toBe(1);
        expect(run.lines.join("\n")).toContain("REFUSED");
        expect(run.lines.join("\n")).toContain(status);
      },
    );

    it("refuses when the job is still queued after the wait", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), [
        "map-rebuild",
        "--workspace",
        workspaceId,
        "--wait-seconds",
        "1",
      ]);

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("still queued");
      expect((await jobsOf(served(), workspaceId))[0]?.status).toBe("queued");
    });
  });

  describe("map-counts — nodes per label and edges, as JSON", () => {
    it("answers the live generation's counts on one diffable line", async () => {
      const { workspaceId } = await served().provision();
      await mapped(served(), workspaceId);

      const run = await ops(served(), ["map-counts", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);

      expect(run.lines).toHaveLength(1);
      expect(answered(run)).toEqual({
        live_gen: 1,
        nodes: { Concept: 2 },
        edges: { LINKS_TO: 1 },
      });
    });

    it("answers zero of everything for an unmapped workspace, never refusing", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), ["map-counts", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(answered(run)).toEqual({ live_gen: null, nodes: {}, edges: {} });
    });

    it("answers usage to a non-id workspace before reading anything", async () => {
      const run = await ops(served(), ["map-counts", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("map-sweep — the generations a finished rebuild left behind", () => {
    it("sweeps all but the live generation, saying what each held", async () => {
      const { workspaceId } = await served().provision();
      await mapped(served(), workspaceId);

      const run = await ops(served(), ["map-sweep", "--workspace", workspaceId, "--wait"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "map-sweep: done — swept generation 2 (2 nodes, 1 edge, 1 unresolved reference)",
      ]);

      const counted = await ops(served(), ["map-counts", "--workspace", workspaceId]);
      expect(answered(counted)).toEqual({
        live_gen: 1,
        nodes: { Concept: 2 },
        edges: { LINKS_TO: 1 },
      });
    });

    it("sweeps nothing when only the live generation stands", async () => {
      const { workspaceId } = await served().provision();

      const run = await ops(served(), ["map-sweep", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["map-sweep: done — nothing to sweep"]);
    });

    it("answers usage to a non-id workspace before deleting anything", async () => {
      const run = await ops(served(), ["map-sweep", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("the two sweeps by hand never overlap the daily pass", () => {
    it.each([
      ["map-sweep", "map-sweep: done — nothing to sweep"],
      [
        "object-store-orphans",
        "object-store-orphans: done — removed 0 objects past the 24-hour grace no document names",
      ],
    ])("%s waits for the pass's sweep lock, then runs", async (command, done) => {
      const { workspaceId } = await served().provision();
      let letGo = (): void => undefined;
      const holding = new Promise<void>((resolve) => {
        letGo = resolve;
      });
      let taken = false;
      const pass = withSweepLock(SWEEPS, openPostgres(served().database.pool), async () => {
        taken = true;
        await holding;
      });
      await until(async () => taken);

      let settled = false;
      const run = ops(served(), [command, "--workspace", workspaceId]).finally(() => {
        settled = true;
      });
      await until(async () => (await countWaitingOnLocks(served().database.superuser)) > 0);
      expect(settled).toBe(false);

      letGo();
      await pass;

      expect(await run).toEqual({ exitCode: 0, lines: [done], logs: [] });
    });
  });
});
