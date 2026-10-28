import { MAP_MAINTENANCE } from "@better-answers/core/concepts";
import type { PlatformPrincipal } from "@better-answers/core/kernel";
import { JOB_IS_OVER, jobById, type JobStatus } from "@better-answers/core/runs";

import type { Doors } from "../doors.ts";
import { DONE, REFUSED, type OpsIo, type Flags, refused, counted } from "./cli.ts";

export const WAIT_SECONDS = 120;
const WAIT_POLL_MS = 2_000;

export const waitSecondsOf = (flags: Flags): number | "malformed" | undefined => {
  const bare = flags.get("wait");
  const named = flags.get("wait-seconds");
  if (bare === undefined && named === undefined) return undefined;
  if (bare !== undefined && bare !== true) return "malformed";
  if (named === undefined) return WAIT_SECONDS;
  const seconds = Number(named);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : "malformed";
};

const after = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const jobAfterWaiting = async (
  platform: PlatformPrincipal,
  doors: Doors,
  jobKey: { readonly workspaceId: string; readonly jobId: string },
  seconds: number,
) => {
  const deadline = doors.clock.now().getTime() + seconds * 1_000;
  const pollMs = Math.min(WAIT_POLL_MS, seconds * 1_000);
  let read = await jobById(platform, doors.postgres, jobKey);
  while (
    read.ok &&
    !JOB_IS_OVER.includes(read.value.status) &&
    doors.clock.now().getTime() < deadline
  ) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the poll sleeps out its interval before it reads the job again
    await after(Math.min(pollMs, Math.max(deadline - doors.clock.now().getTime(), 0)));
    // oxlint-disable-next-line eslint/no-await-in-loop -- each read of the job decides whether the poll goes on
    read = await jobById(platform, doors.postgres, jobKey);
  }
  return read;
};

export const unfinished = (
  jobState: { readonly status: JobStatus; readonly attempts: number },
  seconds: number,
  consequence: string,
): string =>
  JOB_IS_OVER.includes(jobState.status)
    ? `${jobState.status} after ${counted(jobState.attempts, "attempt")}; the job's own row says what it found`
    : `still ${jobState.status} after ${counted(seconds, "second")}, so ${consequence}`;

export const waitForJob = async (
  doors: Doors,
  workspaceId: string,
  jobId: string,
  seconds: number,
  io: OpsIo,
): Promise<number> => {
  const waited = await jobAfterWaiting(MAP_MAINTENANCE, doors, { workspaceId, jobId }, seconds);
  if (!waited.ok) return refused("map-rebuild", workspaceId, waited.error, io);
  if (waited.value.status === "done") {
    io.say(
      `map-rebuild: done — job ${jobId} rebuilt the map on ${counted(waited.value.attempts, "attempt")}`,
    );
    return DONE;
  }
  io.say(
    `map-rebuild: REFUSED — job ${jobId} is ${unfinished(waited.value, seconds, "nothing has rebuilt this map")}`,
  );
  return REFUSED;
};
