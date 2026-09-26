import { describe, expect, it, vi } from "vitest";

import { ok, type UserPrincipal } from "@better-answers/core/kernel";
import { listObjects, putObject } from "@better-answers/core/store/objects";
import { openPostgres } from "@better-answers/core/store/postgres";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import {
  postgresForEachCase,
  until,
  whileWritesAreRefused,
} from "@better-answers/core/testing/postgres";
import { provisionWorkspace } from "@better-answers/core/workspaces";
import { boundarySchemas, ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { SweepSettings } from "../src/config.ts";
import type { Doors } from "../src/doors.ts";
import { startSweeps, SWEEP_INTERVAL_MS, type SweepsDependencies } from "../src/sweeps.ts";
import { capturingLogger, doorsFor, type LogLine } from "./harness.ts";

const PING_URL = "https://hc-ping.com/0f5e8a2c-5d3a-4c55-9d0e-2b8c1f7a6e41";

const objects = objectStoreForSuite();
const db = postgresForEachCase();

const A_DAY_ON = (): Date => new Date(Date.now() + 25 * 60 * 60 * 1000);

const doors = (): Doors => ({
  ...doorsFor(db().runtimePool),
  objects: ok(objects().door),
  clock: { now: A_DAY_ON },
});

type Pinged = { readonly url: string; readonly body: string };

type Running = {
  readonly pinged: Pinged[];
  readonly logs: LogLine[];
  readonly stop: () => Promise<void>;
};

const running = (settings: SweepSettings, overrides: Partial<SweepsDependencies> = {}): Running => {
  const pinged: Pinged[] = [];
  const { logger, logs } = capturingLogger("debug");
  const started = startSweeps({
    doors: doors(),
    settings,
    logger,
    firstPassMs: 0,
    intervalMs: SWEEP_INTERVAL_MS,
    fetch: async (url, init) => {
      pinged.push({ url, body: typeof init.body === "string" ? init.body : "" });
      return new Response(null, { status: 200 });
    },
    ...overrides,
  });
  if (!started.ok) throw new Error(`the sweeps did not start: ${started.error}`);
  const sweeps = started.value;
  return { pinged, logs, stop: () => sweeps.stop() };
};

const onePass = async (settings: SweepSettings): Promise<Running> => {
  const sweeps = running(settings);
  await until(async () => sweeps.pinged.length > 0);
  await sweeps.stop();
  return sweeps;
};

const passes = (logs: readonly LogLine[]): readonly LogLine[] =>
  logs.filter((line) => line["msg"] === "sweep pass");

const provisioned = async () => {
  const client = await db().pool.connect();
  try {
    const admin = await testData(client).user();
    const workspaceId = ulid();
    const made = await provisionWorkspace(
      { kind: "platform", actorId: "process:better-answers-bootstrap" },
      openPostgres(db().runtimePool),
      {
        id: workspaceId,
        name: "Acme",
        slug: `acme-${workspaceId.toLowerCase()}`,
        adminUserId: admin.id,
      },
    );
    if (!made.ok) throw new Error(`the workspace was not provisioned: ${made.error}`);
    const principal: UserPrincipal = {
      kind: "user",
      workspaceId: boundarySchemas.workspace.select.shape.id.parse(workspaceId),
      userId: boundarySchemas.user.select.shape.id.parse(admin.id),
      role: "Admin",
      groups: [],
      credentialIssuedAtMs: Date.now(),
    };
    return { workspaceId, admin: principal };
  } finally {
    client.release();
  }
};

const withAnOrphan = async () => {
  const workspace = await provisioned();
  const orphan = `uploads/${ulid().toLowerCase()}/${ulid().toLowerCase()}/original`;
  const put = await putObject(
    workspace.admin,
    objects().door,
    orphan,
    new Blob(["The bytes of a bind whose row never landed."]).stream(),
  );
  if (!put.ok) throw new Error(`the orphan was refused: ${put.error}`);
  return { ...workspace, orphan };
};

const withMapLeftovers = async () => {
  const workspace = await provisioned();
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const live = await seed.graphNode({ workspaceId: workspace.workspaceId });
    await seed.graphEdge({ workspaceId: workspace.workspaceId, fromUid: live.uid });
    const left = await seed.graphNode({ workspaceId: workspace.workspaceId, gen: 2 });
    await seed.graphEdge({ workspaceId: workspace.workspaceId, gen: 2, fromUid: left.uid });
  } finally {
    client.release();
  }
  return workspace;
};

describe("the sweeps' daily pass", () => {
  it("passes once a day after its first", () => {
    expect(SWEEP_INTERVAL_MS).toBe(86_400_000);
  });

  it("makes its first pass ten minutes in, and none before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const sweeps = running(
        { uploadSweep: "list", pingUrl: PING_URL },
        { firstPassMs: undefined, intervalMs: undefined },
      );

      vi.advanceTimersByTime(599_999);
      expect(sweeps.logs).toEqual([]);

      vi.advanceTimersByTime(1);
      vi.useRealTimers();
      await until(async () => sweeps.pinged.length > 0);
      await sweeps.stop();

      expect(passes(sweeps.logs)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs a pass removing nothing, pinging its check with counts", async () => {
    await provisioned();

    const sweeps = await onePass({ uploadSweep: "list", pingUrl: PING_URL });

    expect(passes(sweeps.logs)).toEqual([
      expect.objectContaining({
        level: 30,
        upload_sweep: "list",
        workspaces: 1,
        found: 0,
        removed: 0,
        generations: 0,
        refused: 0,
        refusals: [],
      }),
    ]);
    expect(sweeps.pinged).toEqual([
      {
        url: PING_URL,
        body: "ok workspaces=1 refused=0 upload_sweep=list found=0 removed=0 generations=0",
      },
    ]);
  });

  it("reports how many orphaned uploads it removed, never a key", async () => {
    const workspace = await withAnOrphan();

    const sweeps = await onePass({ uploadSweep: "remove", pingUrl: PING_URL });

    expect(passes(sweeps.logs)).toEqual([
      expect.objectContaining({ level: 30, upload_sweep: "remove", found: 1, removed: 1 }),
    ]);
    expect(sweeps.pinged).toEqual([
      {
        url: PING_URL,
        body: "ok workspaces=1 refused=0 upload_sweep=remove found=1 removed=1 generations=0",
      },
    ]);
    expect(JSON.stringify(sweeps.logs)).not.toContain("uploads/");
    expect(await listObjects(workspace.admin, objects().door, "")).toEqual({ ok: true, value: [] });
  });

  it("counts orphaned uploads but removes none while list-only", async () => {
    const workspace = await withAnOrphan();

    const sweeps = await onePass({ uploadSweep: "list", pingUrl: PING_URL });

    expect(passes(sweeps.logs)).toEqual([
      expect.objectContaining({ upload_sweep: "list", found: 1, removed: 0 }),
    ]);
    expect(await listObjects(workspace.admin, objects().door, "")).toEqual({
      ok: true,
      value: [workspace.orphan],
    });
  });

  it("skips its pass under a manual sweep's lock, pinging nothing", async () => {
    await withAnOrphan();

    const sweeps = await withSweepLock(SWEEPS, openPostgres(db().runtimePool), async () => {
      const started = running({ uploadSweep: "remove", pingUrl: PING_URL });
      await until(async () =>
        started.logs.some(
          (line) => line["msg"] === "a sweep pass was skipped: another holder has the sweeps' lock",
        ),
      );
      await started.stop();
      return started;
    });

    expect(passes(sweeps.logs)).toEqual([]);
    expect(sweeps.pinged).toEqual([]);
  });

  it("names an unsweepable workspace in the log alone, pinging failure", async () => {
    const stuck = await withMapLeftovers();
    await provisioned();

    const sweeps = await whileWritesAreRefused(db().pool, "graph_node", () =>
      onePass({ uploadSweep: "list", pingUrl: PING_URL }),
    );

    expect(passes(sweeps.logs)).toEqual([
      expect.objectContaining({
        level: 40,
        workspaces: 2,
        generations: 0,
        refused: 1,
        refusals: [{ workspace_id: stuck.workspaceId, sweep: "graph", reason: expect.any(String) }],
      }),
    ]);
    expect(sweeps.pinged).toEqual([
      {
        url: `${PING_URL}/fail`,
        body: "fail workspaces=2 refused=1 upload_sweep=list found=0 removed=0 generations=0",
      },
    ]);
  });

  it("names a workspace whose removals went unrecorded, never the key", async () => {
    const orphaned = await withAnOrphan();

    const sweeps = await whileWritesAreRefused(db().pool, "audit_event", () =>
      onePass({ uploadSweep: "remove", pingUrl: PING_URL }),
    );

    expect(passes(sweeps.logs)).toEqual([
      expect.objectContaining({
        level: 40,
        refused: 1,
        refusals: [
          { workspace_id: orphaned.workspaceId, sweep: "uploads", reason: expect.any(String) },
        ],
      }),
    ]);
    expect(JSON.stringify(sweeps.logs)).not.toContain(orphaned.orphan);
    expect(JSON.stringify(sweeps.logs)).not.toContain("uploads/");
  });

  it("logs and pings failure when its row cannot be written", async () => {
    await provisioned();

    const sweeps = await whileWritesAreRefused(db().pool, "sweep_pass", () =>
      onePass({ uploadSweep: "list", pingUrl: PING_URL }),
    );

    expect(passes(sweeps.logs)).toEqual([]);
    expect(sweeps.logs).toContainEqual(
      expect.objectContaining({
        level: 50,
        msg: "the sweep pass failed",
        reason: expect.stringContaining("its row was not written"),
      }),
    );
    expect(sweeps.pinged).toEqual([{ url: `${PING_URL}/fail`, body: "fail" }]);
  });

  it("still sweeps and logs when the estate names no check", async () => {
    await provisioned();
    const sweeps = running({ uploadSweep: "list", pingUrl: undefined });

    await until(async () => passes(sweeps.logs).length > 0);
    await sweeps.stop();

    expect(sweeps.pinged).toEqual([]);
  });

  it("passes again on its interval, and stops when told", async () => {
    const sweeps = running({ uploadSweep: "list", pingUrl: PING_URL }, { intervalMs: 20 });

    await until(async () => sweeps.pinged.length >= 2);
    await sweeps.stop();
    const stoppedAt = sweeps.pinged.length;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(sweeps.pinged).toHaveLength(stoppedAt);
  });

  it("refuses to start without an object store, logging nothing", () => {
    const { logger, logs } = capturingLogger();

    const refused = startSweeps({
      doors: { ...doors(), objects: undefined },
      settings: { uploadSweep: "list", pingUrl: PING_URL },
      logger,
    });

    expect(refused).toEqual({ ok: false, error: "no-object-store" });
    expect(logs).toEqual([]);
  });
});
