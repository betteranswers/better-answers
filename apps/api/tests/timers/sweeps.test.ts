import { describe, expect, it, vi } from "vitest";

import { ok, type UserPrincipal } from "@better-answers/core/kernel";
import { listObjects, putObject } from "@better-answers/core/store/objects";
import { consumeIngress, openPostgres } from "@better-answers/core/store/postgres";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import {
  postgresForEachCase,
  until,
  whileWritesAreRefused,
} from "@better-answers/core/testing/postgres";
import { provisionWorkspace } from "@better-answers/core/workspaces";
import { boundarySchemas, ulid } from "@better-answers/schema";
import {
  contentPartitionOf,
  contentPartitions,
  inTheMonth,
  testData,
} from "@better-answers/schema/testing";
import { matching } from "@better-answers/schema/testing/matching";

import type { SweepSettings } from "../../src/config.ts";
import type { Doors } from "../../src/doors.ts";
import {
  startSweeps,
  SWEEP_FIRST_PASS_MS,
  SWEEP_INTERVAL_MS,
  type SweepsDependencies,
} from "../../src/timers/sweeps.ts";
import { capturingLogger, doorsFor, type LogLine } from "../support/harness/harness.ts";

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

const startTestSweeps = (
  settings: SweepSettings,
  overrides: Partial<SweepsDependencies> = {},
): Running => {
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

const onePass = async (
  settings: SweepSettings,
  overrides: Partial<SweepsDependencies> = {},
): Promise<Running> => {
  const sweeps = startTestSweeps(settings, overrides);
  await until(async () => sweeps.pinged.length > 0);
  await sweeps.stop();
  return sweeps;
};

const LATE_NEXT_MONTH = inTheMonth(1, 27);

const onePassAt = (now: Date): Promise<Running> =>
  onePass(
    { uploadSweep: "list", pingUrl: PING_URL },
    { doors: { ...doors(), clock: { now: () => now } } },
  );

const contentMonths = async (): Promise<readonly string[]> =>
  (await contentPartitions(db().pool)).map((partition) => partition.name);

const monthsOn = (...months: readonly number[]): readonly string[] =>
  months.map((month) => contentPartitionOf(inTheMonth(month)));

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
        shortName: `acme-${workspaceId.toLowerCase()}`,
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
      secondFactorConfirmedAtMs: Date.now(),
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
    new Blob(["The bytes of a connect whose row never landed."]).stream(),
  );
  if (!put.ok) throw new Error(`the orphan was refused: ${put.error}`);
  return { ...workspace, orphan };
};

const withMapLeftovers = async () => {
  const workspace = await provisioned();
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const live = await seed.mapNode({ workspaceId: workspace.workspaceId });
    await seed.mapEdge({ workspaceId: workspace.workspaceId, fromUid: live.uid });
    const left = await seed.mapNode({ workspaceId: workspace.workspaceId, gen: 2 });
    await seed.mapEdge({ workspaceId: workspace.workspaceId, gen: 2, fromUid: left.uid });
  } finally {
    client.release();
  }
  return workspace;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const codeExpiring = async (fromThePassMs: number): Promise<string> => {
  const client = await db().pool.connect();
  try {
    const expiresAt = new Date(A_DAY_ON().getTime() + fromThePassMs);
    return (await testData(client).verification({ expiresAt })).identifier;
  } finally {
    client.release();
  }
};

const verificationsLeft = async (): Promise<readonly string[]> =>
  (
    await db().pool.query<{ identifier: string }>(
      "SELECT identifier FROM verification ORDER BY expires_at",
    )
  ).rows.map((row) => row.identifier);

describe("the daily sweep pass", () => {
  it("runs once a day after the first pass", () => {
    expect(SWEEP_INTERVAL_MS).toBe(86_400_000);
  });

  it("waits ten minutes after startup before the first pass", () => {
    expect(SWEEP_FIRST_PASS_MS).toBe(600_000);
  });

  it("runs the first pass at ten minutes and not before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const sweeps = startTestSweeps(
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

  it("logs an empty pass and pings the check with counts", async () => {
    await provisioned();

    const sweeps = await onePass({ uploadSweep: "list", pingUrl: PING_URL });

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({
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

  it("removes orphaned uploads and logs their count, never their keys", async () => {
    const workspace = await withAnOrphan();

    const sweeps = await onePass({ uploadSweep: "remove", pingUrl: PING_URL });

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({ level: 30, upload_sweep: "remove", found: 1, removed: 1 }),
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

  it("counts orphaned uploads but keeps them in list mode", async () => {
    const workspace = await withAnOrphan();

    const sweeps = await onePass({ uploadSweep: "list", pingUrl: PING_URL });

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({ upload_sweep: "list", found: 1, removed: 0 }),
    ]);
    expect(await listObjects(workspace.admin, objects().door, "")).toEqual({
      ok: true,
      value: [workspace.orphan],
    });
  });

  it("deletes codes expired for over a day, keeping newer ones", async () => {
    await codeExpiring(-24 * HOUR_MS - MINUTE_MS);
    const justUnderADay = await codeExpiring(-24 * HOUR_MS + MINUTE_MS);
    const withinTheDay = await codeExpiring(-1 * HOUR_MS);
    const live = await codeExpiring(5 * 60 * 1000);

    const sweeps = await onePass({ uploadSweep: "list", pingUrl: PING_URL });

    expect(await verificationsLeft()).toEqual([justUnderADay, withinTheDay, live]);
    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({ level: 30, verifications_deleted: 1 }),
    ]);
  });

  it("logs identity-set deletions as counts without any email address", async () => {
    const identifier = await codeExpiring(-25 * HOUR_MS);
    const address = identifier.slice("sign-in-otp-".length);
    await consumeIngress(
      openPostgres(db().runtimePool),
      "email",
      address,
      { windowMs: MINUTE_MS, max: 5 },
      new Date(A_DAY_ON().getTime() - 25 * HOUR_MS),
    );

    const sweeps = await onePass({ uploadSweep: "list", pingUrl: PING_URL });

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({
        level: 30,
        sessions_deleted: 0,
        verifications_deleted: 1,
        ingress_windows_deleted: 1,
        refusals: [],
      }),
    ]);
    expect(JSON.stringify(sweeps.logs)).not.toContain(address);
  });

  it("logs a refused code deletion and pings failure", async () => {
    await codeExpiring(-25 * HOUR_MS);

    const sweeps = await whileWritesAreRefused(db().pool, "verification", () =>
      onePass({ uploadSweep: "list", pingUrl: PING_URL }),
    );

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({
        level: 40,
        verifications_deleted: 0,
        refusals: [{ sweep: "verifications", reason: matching.any(String) }],
      }),
    ]);
    expect(sweeps.pinged).toEqual([
      {
        url: `${PING_URL}/fail`,
        body: "fail workspaces=0 refused=0 upload_sweep=list found=0 removed=0 generations=0",
      },
    ]);
  });

  it("skips the pass without pinging while another holds the lock", async () => {
    await withAnOrphan();

    const sweeps = await withSweepLock(SWEEPS, openPostgres(db().runtimePool), async () => {
      const started = startTestSweeps({ uploadSweep: "remove", pingUrl: PING_URL });
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

  it("logs only the workspace it cannot sweep and pings failure", async () => {
    const stuck = await withMapLeftovers();
    await provisioned();

    const sweeps = await whileWritesAreRefused(db().pool, "map_node", () =>
      onePass({ uploadSweep: "list", pingUrl: PING_URL }),
    );

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({
        level: 40,
        workspaces: 2,
        generations: 0,
        refused: 1,
        refusals: [{ workspace_id: stuck.workspaceId, sweep: "map", reason: matching.any(String) }],
      }),
    ]);
    expect(sweeps.pinged).toEqual([
      {
        url: `${PING_URL}/fail`,
        body: "fail workspaces=2 refused=1 upload_sweep=list found=0 removed=0 generations=0",
      },
    ]);
  });

  it("names the workspace, not keys, when upload removals go unaudited", async () => {
    const orphaned = await withAnOrphan();

    const sweeps = await whileWritesAreRefused(db().pool, "audit_event", () =>
      onePass({ uploadSweep: "remove", pingUrl: PING_URL }),
    );

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({
        level: 40,
        refused: 1,
        refusals: [
          { workspace_id: orphaned.workspaceId, sweep: "uploads", reason: matching.any(String) },
        ],
      }),
    ]);
    expect(JSON.stringify(sweeps.logs)).not.toContain(orphaned.orphan);
    expect(JSON.stringify(sweeps.logs)).not.toContain("uploads/");
  });

  it("logs and pings failure when the sweep_pass row is refused", async () => {
    await provisioned();

    const sweeps = await whileWritesAreRefused(db().pool, "sweep_pass", () =>
      onePass({ uploadSweep: "list", pingUrl: PING_URL }),
    );

    expect(passes(sweeps.logs)).toEqual([]);
    expect(sweeps.logs).toContainEqual(
      matching.objectContaining({
        level: 50,
        msg: "the sweep pass failed",
        reason: matching.stringContaining("sweep_pass"),
      }),
    );
    expect(sweeps.pinged).toEqual([{ url: `${PING_URL}/fail`, body: "fail" }]);
  });

  it("deletes expired codes even when the workspace sweep fails", async () => {
    await provisioned();
    await codeExpiring(-25 * HOUR_MS);
    const live = await codeExpiring(5 * MINUTE_MS);

    const sweeps = await whileWritesAreRefused(db().pool, "sweep_pass", () =>
      onePass({ uploadSweep: "list", pingUrl: PING_URL }),
    );

    expect(await verificationsLeft()).toEqual([live]);
    expect(sweeps.logs).toContainEqual(
      matching.objectContaining({
        level: 50,
        msg: "the sweep pass failed",
        sessions_deleted: 0,
        verifications_deleted: 1,
        ingress_windows_deleted: 0,
        refusals: [],
      }),
    );
    expect(sweeps.pinged).toEqual([{ url: `${PING_URL}/fail`, body: "fail" }]);
  });

  it("creates the question content partition for the following month", async () => {
    expect(await contentMonths()).toEqual(monthsOn(0, 1));

    const sweeps = await onePassAt(LATE_NEXT_MONTH);

    expect(await contentMonths()).toEqual(monthsOn(0, 1, 2));
    expect(passes(sweeps.logs)).toEqual([matching.objectContaining({ level: 30, refusals: [] })]);
  });

  it("logs a partition it cannot create and pings failure", async () => {
    await db().pool.query(
      "REVOKE EXECUTE ON FUNCTION create_question_content_partition(date) FROM app_rt",
    );

    const sweeps = await onePassAt(LATE_NEXT_MONTH);

    expect(await contentMonths()).toEqual(monthsOn(0, 1));
    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({
        level: 40,
        refusals: [{ sweep: "question-months", reason: matching.any(String) }],
      }),
    ]);
    expect(sweeps.pinged.map((ping) => ping.url)).toEqual([`${PING_URL}/fail`]);
  });

  it("sweeps without pinging when no check URL is configured", async () => {
    await provisioned();
    const sweeps = startTestSweeps({ uploadSweep: "list", pingUrl: undefined });

    await until(async () => passes(sweeps.logs).length > 0);
    await sweeps.stop();

    expect(sweeps.pinged).toEqual([]);
  });

  it("repeats the pass each interval and stops when told", async () => {
    const sweeps = startTestSweeps({ uploadSweep: "list", pingUrl: PING_URL }, { intervalMs: 20 });

    await until(async () => sweeps.pinged.length >= 2);
    await sweeps.stop();
    const stoppedAt = sweeps.pinged.length;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(sweeps.pinged).toHaveLength(stoppedAt);
  });

  it("refuses to start without an object store and logs nothing", () => {
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

const takeSpendReservation = async (workspaceId: string): Promise<void> => {
  const client = await db().pool.connect();
  try {
    await testData(client).spendReservation({ workspaceId });
  } finally {
    client.release();
  }
};

describe("the daily sweep pass and spend reservations", () => {
  it("logs how many spend reservations it settled", async () => {
    const { workspaceId } = await provisioned();
    await takeSpendReservation(workspaceId);

    const sweeps = await onePass({ uploadSweep: "list", pingUrl: PING_URL });

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({ level: 30, reservations_settled: 1, refusals: [] }),
    ]);
  });

  it("logs a refused settlement and pings failure", async () => {
    const { workspaceId } = await provisioned();
    await takeSpendReservation(workspaceId);

    const sweeps = await whileWritesAreRefused(db().pool, "llm_call", () =>
      onePass({ uploadSweep: "list", pingUrl: PING_URL }),
    );

    expect(passes(sweeps.logs)).toEqual([
      matching.objectContaining({
        level: 40,
        reservations_settled: 0,
        refusals: [
          {
            workspace_id: workspaceId,
            sweep: "spend",
            reason: matching.stringContaining("the store refused a write to llm_call"),
          },
        ],
      }),
    ]);
    expect(sweeps.pinged.map((ping) => ping.url)).toEqual([`${PING_URL}/fail`]);
  });
});
