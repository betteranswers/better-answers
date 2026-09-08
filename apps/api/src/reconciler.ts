import type { Pool } from "pg";
import type { Logger } from "pino";

import {
  RECONCILER,
  reconcileEveryWorkspace,
  type WorkspaceReconciled,
} from "@better-answers/core/concepts";
import { attempt, type Clock } from "@better-answers/core/kernel";
import { openGit } from "@better-answers/core/store/git";
import { openPostgres } from "@better-answers/core/store/postgres";

import { logger as tierLogger } from "./logger.ts";
import { reasonOf } from "./ops/index.ts";

/**
 * The periodic head check — the reconciler's trigger in the api process (ADR 0012, amended
 * 2026-09-06; T-006 spec, *The reconciler*). On an interval it asks every workspace's bundle
 * whether its head is ahead of its rows, and the slice replays what the rows missed through
 * the live handler, under the reconciler's own principal and never a person's.
 * This file is the trigger and nothing else: what a replay is, and what it lands, is the
 * concepts slice's (ADR 0029); the api tier says when, and says what came of it.
 *
 * **One tick at a time.** A tick that has not finished — a slow replay, a bundle held by a
 * live act — is not joined by the next one: the interval fires, sees a tick in flight, says
 * so, and waits for the interval after. The per-repository lock in the git door is the
 * fence between a replay and a live write on one bundle, proved at the slice's seam, so no
 * second lock is taken here; the guard is against this process running beside itself.
 *
 * **No metric, no counter.** Each tick logs its outcome once, and *reconciler hits* stay a
 * query over the ledger rows the replay writes (ADR 0025; `reconcilerHits` in the slice).
 * The timer is `unref`'d, so a process that is otherwise done does not wait on it.
 */

/**
 * How often the head is checked. Thirty seconds is the bound on how long a bundle whose
 * rows are behind stays that way — and stays unwritable, since a live write on an
 * unrecorded head fails on the parent key until the tick heals it (ADR 0012, amended
 * 2026-09-07). Each tick that finds nothing costs one read of `bundle_commit` and one of
 * the ref per workspace.
 */
export const RECONCILER_INTERVAL_MS = 30_000;

export type ReconcilerDependencies = {
  readonly database: Pool;
  /** The bare repositories' root — `<root>/<workspace>.git` (ADR 0024). */
  readonly gitStoreDir: string;
  readonly intervalMs?: number | undefined;
  readonly logger?: Logger | undefined;
  /** This process's Clock (ADR 0040), for the replay's landing instant on each tick. */
  readonly clock: Clock;
};

export type Reconciler = {
  /** No tick starts after this; the one in flight, if any, is awaited. */
  stop(): Promise<void>;
};

/** One pass over every workspace, as one line: counts, and the two lists an operator reads. */
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

export const startReconciler = (dependencies: ReconcilerDependencies): Reconciler => {
  const logger = dependencies.logger ?? tierLogger;
  const doors = {
    git: openGit(dependencies.gitStoreDir),
    postgres: openPostgres(dependencies.database),
    clock: dependencies.clock,
  };

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
    // Worth a line only when something happened: a warning an operator reads when a
    // workspace refused or stopped, a note when a replay landed, and otherwise quiet — a
    // tick that found nothing is the ordinary case, thousands of times a day.
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

  return {
    stop: async () => {
      clearInterval(timer);
      await inFlight;
    },
  };
};
