import type { Logger } from "pino";

import {
  followSyncsInEveryWorkspace,
  RECONCILER,
  reconcileEveryWorkspace,
  SYNC_CASCADE,
  type WorkspaceReconciled,
  type WorkspaceSyncsFollowed,
} from "@better-answers/core/concepts";
import { attemptResult, err, ok, type Result } from "@better-answers/core/kernel";

import type { HeadCheckSettings } from "./config.ts";
import { deadManPing, type PingFetch, type PingOutcome } from "./dead-man-ping.ts";
import type { Doors } from "./doors.ts";
import { logger as tierLogger } from "./logger.ts";
import { reasonOf } from "./ops/index.ts";

export const RECONCILER_INTERVAL_MS = 30_000;

/**
 * At thirty seconds a tick, every second tick is once a minute, the scheduler check's period; a
 * ping each tick tells it nothing more.
 */
const TICKS_PER_PING = 2;

export type ReconcilerDependencies = {
  readonly doors: Doors;
  readonly settings: HeadCheckSettings;

  readonly fetch?: PingFetch | undefined;
  readonly intervalMs?: number | undefined;
  readonly logger?: Logger | undefined;
};

export type ReconcilerRefusal = "no-bundle-store";

export type Reconciler = {
  stop(): Promise<void>;
};

const summaryOf = (outcomes: readonly WorkspaceReconciled[]) => {
  let replayed = 0;
  let alreadyLanded = 0;
  const stopped: { workspace_id: string; commit_sha: string; reason: string }[] = [];
  const refused: { workspace_id: string; reason: string }[] = [];
  for (const { workspaceId, outcome } of outcomes) {
    if (!outcome.ok) {
      refused.push({ workspace_id: workspaceId, reason: reasonOf(outcome.error) });
      continue;
    }
    replayed += outcome.value.replayed.length;
    alreadyLanded += outcome.value.skipped.length;
    if (outcome.value.stopped !== undefined) {
      stopped.push({
        workspace_id: workspaceId,
        commit_sha: outcome.value.stopped.sha,
        reason: reasonOf(outcome.value.stopped.reason),
      });
    }
  }
  return { workspaces: outcomes.length, replayed, already_landed: alreadyLanded, stopped, refused };
};

const followedSummaryOf = (passes: readonly Result<WorkspaceSyncsFollowed, Error>[]) => {
  let followed = 0;
  let concepts = 0;
  const skipped: { workspace_id: string; job_id: string; reason: string }[] = [];
  const refused: { reason: string }[] = [];
  for (const pass of passes) {
    if (!pass.ok) {
      refused.push({ reason: pass.error.message });
      continue;
    }
    followed += pass.value.followed.length;
    concepts += pass.value.followed.reduce((sum, sync) => sum + sync.concepts, 0);
    for (const { jobId, reason } of pass.value.skipped) {
      skipped.push({ workspace_id: pass.value.workspaceId, job_id: jobId, reason });
    }
  }
  return { workspaces: passes.length, followed, concepts, skipped, refused };
};

export const startReconciler = (
  dependencies: ReconcilerDependencies,
): Result<Reconciler, ReconcilerRefusal> => {
  const logger = dependencies.logger ?? tierLogger;
  const { git, postgres, clock } = dependencies.doors;
  if (git?.ok !== true) return err("no-bundle-store");
  const doors = { git: git.value, postgres, clock };
  const ping = deadManPing({
    check: "scheduler",
    url: dependencies.settings.pingUrl,
    logger,
    fetch: dependencies.fetch,
  });

  const reconciling = async (): Promise<PingOutcome> => {
    const pass = await attemptResult(() => reconcileEveryWorkspace(RECONCILER, doors));
    if (!pass.ok) {
      logger.error({ reason: pass.error.message }, "the reconciler tick failed");
      return "fail";
    }
    const summary = summaryOf(pass.value);

    if (summary.stopped.length > 0 || summary.refused.length > 0) {
      logger.warn(summary, "reconciler tick");
    } else if (summary.replayed > 0) {
      logger.info(summary, "reconciler tick");
    } else {
      logger.debug(summary, "reconciler tick");
    }
    return "ok";
  };

  /** A sync it skips stays visible wider than its evidence, so the ping says so, not the log alone. */
  const followingSyncs = async (): Promise<PingOutcome> => {
    const pass = await attemptResult(() => followSyncsInEveryWorkspace(SYNC_CASCADE, postgres));
    if (!pass.ok) {
      logger.error({ reason: pass.error.message }, "the sync cascade tick failed");
      return "fail";
    }
    const summary = followedSummaryOf(pass.value);
    if (summary.skipped.length > 0 || summary.refused.length > 0) {
      logger.warn(summary, "sync cascade tick");
      return "fail";
    }
    if (summary.followed > 0) logger.info(summary, "sync cascade tick");
    else logger.debug(summary, "sync cascade tick");
    return "ok";
  };

  const tick = async (): Promise<PingOutcome> => {
    const reconciled = await reconciling();
    const followed = await followingSyncs();
    return reconciled === "fail" || followed === "fail" ? "fail" : "ok";
  };

  /** A tick never awaits its ping, so a slow check cannot hold the next tick back. */
  const pinging = new Set<Promise<void>>();
  let ticked = 0;
  let failedSincePing = false;
  const pingOnTheMinute = (outcome: PingOutcome): void => {
    ticked += 1;
    failedSincePing ||= outcome === "fail";
    if (ticked % TICKS_PER_PING !== 0) return;
    const reported: PingOutcome = failedSincePing ? "fail" : "ok";
    failedSincePing = false;
    const sent = ping(reported);
    pinging.add(sent);
    void sent.finally(() => pinging.delete(sent));
  };

  let inFlight: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (inFlight !== undefined) {
      logger.warn("a reconciler tick was skipped: the previous one is still running");
      return;
    }
    inFlight = tick()
      .then(pingOnTheMinute)
      .finally(() => {
        inFlight = undefined;
      });
  }, dependencies.intervalMs ?? RECONCILER_INTERVAL_MS);
  timer.unref();

  return ok({
    stop: async () => {
      clearInterval(timer);
      await inFlight;
      await Promise.all(pinging);
    },
  });
};
