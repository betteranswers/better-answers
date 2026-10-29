import { MAP_MAINTENANCE, mapCounts, rebuildMap, sweepMap } from "@better-answers/core/concepts";
import { err, ok, type Result } from "@better-answers/core/kernel";
import type { RebuildReason } from "@better-answers/core/runs";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";
import { REBUILD_REASONS } from "@better-answers/schema";

import type { Doors } from "../doors.ts";
import { DONE, type OpsIo, type Flags, flagValue, refused, plural, counted } from "./cli.ts";
import { waitSecondsOf, waitForJob } from "./job-wait.ts";

export const REBUILD_DEFAULT_REASON = "drill";

export const mapCountsCommand = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const counts = await mapCounts(MAP_MAINTENANCE, doors.postgres, { workspaceId });
  if (!counts.ok) return refused("map-counts", workspaceId, counts.error, io);
  const { liveGen, nodes, edges } = counts.value;
  io.say(JSON.stringify({ live_gen: liveGen, nodes, edges }));
  return DONE;
};

type MapRebuildAsked = {
  readonly reason: RebuildReason;
  readonly wait: number | undefined;
};

export const mapRebuildAskedOf = (flags: Flags): Result<MapRebuildAsked, string> => {
  const given = flagValue(flags, "reason") ?? REBUILD_DEFAULT_REASON;
  const reason = REBUILD_REASONS.find((word) => word === given);
  if (reason === undefined) return err(`--reason must be one of ${REBUILD_REASONS.join(", ")}`);
  const wait = waitSecondsOf(flags);
  if (wait === "malformed") {
    return err("--wait takes no value; --wait-seconds takes a whole number of seconds");
  }
  return ok({ reason, wait });
};

export const mapRebuildCommand = async (
  doors: Doors,
  workspaceId: string,
  { reason, wait }: MapRebuildAsked,
  io: OpsIo,
): Promise<number> => {
  const enqueued = await rebuildMap(MAP_MAINTENANCE, doors.postgres, { workspaceId, reason });
  if (!enqueued.ok) return refused("map-rebuild", workspaceId, enqueued.error, io);
  const { jobId } = enqueued.value;
  if (wait === undefined) {
    io.say(`map-rebuild: done — enqueued ${jobId}`);
    return DONE;
  }
  return waitForJob(doors, workspaceId, jobId, wait, io);
};

export const mapSweepCommand = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const swept = await withSweepLock(SWEEPS, doors.postgres, () =>
    sweepMap(MAP_MAINTENANCE, doors.postgres, { workspaceId }),
  );
  if (!swept.ok) return refused("map-sweep", workspaceId, swept.error, io);
  if (swept.value.length === 0) {
    io.say("map-sweep: done — nothing to sweep");
    return DONE;
  }
  const generations = swept.value.map((generation) => generation.gen).join(", ");
  const nodes = swept.value.reduce((total, generation) => total + generation.nodes, 0);
  const edges = swept.value.reduce((total, generation) => total + generation.edges, 0);
  const unresolved = swept.value.reduce((total, generation) => total + generation.unresolved, 0);
  io.say(
    `map-sweep: done — swept ${plural(swept.value.length, "generation")} ${generations} (${counted(nodes, "node")}, ${counted(edges, "edge")}, ${counted(unresolved, "unresolved reference")})`,
  );
  return DONE;
};
