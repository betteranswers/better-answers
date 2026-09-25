import type { Logger } from "pino";

import { attempt, err, ok, type Result } from "@better-answers/core/kernel";
import { SWEEPS, sweepEveryWorkspace, type SweepPass } from "@better-answers/core/sweeps";

import type { SweepSettings } from "./config.ts";
import { deadManPing, type PingFetch, type PingOutcome } from "./dead-man-ping.ts";
import type { Doors } from "./doors.ts";
import { logger as tierLogger } from "./logger.ts";
import { reasonOf } from "./ops/index.ts";

export const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Soon after a start, not a day after: releases more often than daily would restart the wait
 * before any pass ran.
 */
export const SWEEP_FIRST_PASS_MS = 10 * 60 * 1000;

export type SweepsDependencies = {
  readonly doors: Doors;
  readonly settings: SweepSettings;

  readonly fetch?: PingFetch | undefined;
  readonly logger?: Logger | undefined;
  readonly firstPassMs?: number | undefined;
  readonly intervalMs?: number | undefined;
};

export type SweepsRefusal = "no-object-store";

export type Sweeps = {
  stop(): Promise<void>;
};

const refusalsOf = (pass: SweepPass) =>
  pass.swept.flatMap(({ workspaceId, uploads, graph }) => [
    ...(uploads.ok
      ? []
      : [{ workspace_id: workspaceId, sweep: "uploads", reason: reasonOf(uploads.error) }]),
    ...(graph.ok
      ? []
      : [{ workspace_id: workspaceId, sweep: "graph", reason: reasonOf(graph.error) }]),
  ]);

/** Counts, never a workspace, a key or an error. */
const sizesOf = (pass: SweepPass): string => {
  const { workspaces, refused, found, removed, generations } = pass.totals;
  return `workspaces=${workspaces} refused=${refused} upload_sweep=${pass.uploadSweep} found=${found} removed=${removed} generations=${generations}`;
};

export const startSweeps = (dependencies: SweepsDependencies): Result<Sweeps, SweepsRefusal> => {
  const logger = dependencies.logger ?? tierLogger;
  const { postgres, objects, clock } = dependencies.doors;
  if (objects?.ok !== true) return err("no-object-store");
  const doors = { postgres, objects: objects.value, clock };
  const { uploadSweep, pingUrl } = dependencies.settings;
  const ping = deadManPing({
    check: "sweeps",
    url: pingUrl,
    logger,
    fetch: dependencies.fetch,
  });

  const pass = async (): Promise<void> => {
    const run = await attempt(() => sweepEveryWorkspace(SWEEPS, doors, { uploadSweep }));
    const swept = run.ok ? run.value : err(run.error);
    if (!swept.ok) {
      if (swept.error === "held") {
        logger.warn("a sweep pass was skipped: another holder has the sweeps' lock");
        return;
      }
      logger.error({ reason: swept.error.message }, "the sweep pass failed");
      await ping("fail");
      return;
    }
    const refusals = refusalsOf(swept.value);
    const summary = { upload_sweep: uploadSweep, ...swept.value.totals, refusals };
    const outcome: PingOutcome = refusals.length > 0 ? "fail" : "ok";
    if (outcome === "fail") logger.warn(summary, "sweep pass");
    else logger.info(summary, "sweep pass");
    await ping(outcome, sizesOf(swept.value));
  };

  let inFlight: Promise<void> | undefined;
  const fire = (): void => {
    if (inFlight !== undefined) {
      logger.warn("a sweep pass was skipped: the previous one is still running");
      return;
    }
    inFlight = pass().finally(() => {
      inFlight = undefined;
    });
  };

  let interval: NodeJS.Timeout | undefined;
  const first = setTimeout(() => {
    fire();
    interval = setInterval(fire, dependencies.intervalMs ?? SWEEP_INTERVAL_MS);
    interval.unref();
  }, dependencies.firstPassMs ?? SWEEP_FIRST_PASS_MS);
  first.unref();

  return ok({
    stop: async () => {
      clearTimeout(first);
      clearInterval(interval);
      await inFlight;
    },
  });
};
