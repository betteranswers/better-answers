import type { Logger } from "pino";

import {
  RECONCILER,
  reconcileEveryWorkspace,
  type WorkspaceReconciled,
} from "@better-answers/core/concepts";
import { attempt, err, ok, type Result } from "@better-answers/core/kernel";

import type { Doors } from "./doors.ts";
import { logger as tierLogger } from "./logger.ts";
import { reasonOf } from "./ops/index.ts";

export const RECONCILER_INTERVAL_MS = 30_000;

export type ReconcilerDependencies = {
  readonly doors: Doors;

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

export const startReconciler = (
  dependencies: ReconcilerDependencies,
): Result<Reconciler, ReconcilerRefusal> => {
  const logger = dependencies.logger ?? tierLogger;
  const { git, postgres, clock } = dependencies.doors;
  if (git?.ok !== true) return err("no-bundle-store");
  const doors = { git: git.value, postgres, clock };

  const tick = async (): Promise<void> => {
    const pass = await attempt(() => reconcileEveryWorkspace(RECONCILER, doors));
    if (!pass.ok) {
      logger.error({ reason: pass.error.message }, "the reconciler tick failed");
      return;
    }
    if (!pass.value.ok) {
      logger.error(
        { reason: pass.value.error.message },
        "the reconciler could not list the workspaces",
      );
      return;
    }
    const summary = summaryOf(pass.value.value);

    if (summary.stopped.length > 0 || summary.refused.length > 0) {
      logger.warn(summary, "reconciler tick");
    } else if (summary.replayed > 0) {
      logger.info(summary, "reconciler tick");
    } else {
      logger.debug(summary, "reconciler tick");
    }
  };

  let inFlight: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (inFlight !== undefined) {
      logger.warn("a reconciler tick was skipped: the previous one is still running");
      return;
    }
    inFlight = tick().finally(() => {
      inFlight = undefined;
    });
  }, dependencies.intervalMs ?? RECONCILER_INTERVAL_MS);
  timer.unref();

  return ok({
    stop: async () => {
      clearInterval(timer);
      await inFlight;
    },
  });
};
