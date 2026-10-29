import { getTableName } from "drizzle-orm";

import {
  ERASURE,
  rehearseErasure,
  replayErasures,
  seedSyntheticSubject,
  type ErasureDoors,
  type ErasureLog,
  type RehearsalRefusal,
} from "@better-answers/core/erasure";
import { err, ok, type Result } from "@better-answers/core/kernel";
import { tablesPresent } from "@better-answers/core/store/postgres";
import { erasureRequest } from "@better-answers/schema";

import { doorTold, type Doors } from "../doors.ts";
import {
  DONE,
  REFUSED,
  type OpsIo,
  parseSince,
  type Flags,
  flagValue,
  bundleStore,
  refused,
  counted,
} from "./cli.ts";
import { WAIT_SECONDS, waitSecondsOf, jobAfterWaiting, unfinished } from "./job-wait.ts";

const erasureDoors = (doors: Doors, log: ErasureLog): Result<ErasureDoors, string> => {
  const git = bundleStore(doors, "the bundles an erasure rewrites cannot be opened");
  if (!git.ok) return err(git.error);
  const objects = doorTold(
    doors.objects,
    "no object store is configured (S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY on the api service), so the replay copies an erasure leaves cannot be read",
  );
  if (!objects.ok) return err(objects.error);
  return ok({
    git: git.value,
    postgres: doors.postgres,
    objects: objects.value,
    clock: doors.clock,
    log,
  });
};

type ReplayErasuresAsked = { readonly since: Date };

export const replayErasuresAskedOf = (flags: Flags): Result<ReplayErasuresAsked, string> => {
  const sinceArgument = flagValue(flags, "since");
  const since = sinceArgument === undefined ? undefined : parseSince(sinceArgument);
  return since === undefined
    ? err("--since <dump stamp or ISO instant> is required")
    : ok({ since });
};

export const replayErasuresCommand = async (
  doors: Doors,
  { since }: ReplayErasuresAsked,
  io: OpsIo,
): Promise<number> => {
  const requests = getTableName(erasureRequest);
  const present = await tablesPresent(doors.postgres, [requests]);
  if (present.length === 0) {
    io.say(
      `replayed 0 erasures since ${since.toISOString()}: no ${requests} table exists in this schema, so no erasure has ever been recorded here`,
    );
    return DONE;
  }
  const opened = erasureDoors(doors, io.logger);
  if (!opened.ok) {
    io.say(`replay-erasures: REFUSED — ${opened.error}; do not start api`);
    return REFUSED;
  }
  const replayed = await replayErasures(ERASURE, opened.value, { since });
  if (!replayed.ok) {
    io.say(`replay-erasures: REFUSED — ${replayed.error.message}; do not start api`);
    return REFUSED;
  }
  for (const erasure of replayed.value) {
    io.say(
      `replay-erasures: ${erasure.erasureRequestId} in workspace ${erasure.workspaceId} — ` +
        `completed ${erasure.completedAt.toISOString()}, ` +
        `${erasure.fromReplayCopy ? "re-created from its replay copy" : "read from the restored rows"}`,
    );
  }
  io.say(
    `replay-erasures: done — replayed ${counted(replayed.value.length, "erasure")} since ${since.toISOString()}`,
  );
  return DONE;
};

const rehearsalSaid = (reason: RehearsalRefusal | Error): string | undefined =>
  reason === "not-seeded"
    ? "no synthetic subject stands in this workspace — phase one (--seed) has not been run here, or its subject has already been erased"
    : undefined;

const seedingToBeDumped = async (
  doors: Doors,
  erasure: ErasureDoors,
  workspaceId: string,
  waitSeconds: number,
  io: OpsIo,
): Promise<number> => {
  const seeded = await seedSyntheticSubject(ERASURE, erasure, { workspaceId });
  if (!seeded.ok) {
    return refused("erasure-rehearsal", workspaceId, seeded.error, io, rehearsalSaid(seeded.error));
  }
  const { indexJobId } = seeded.value.document;
  const indexed = await jobAfterWaiting(
    ERASURE,
    doors,
    { workspaceId, jobId: indexJobId },
    waitSeconds,
  );
  if (!indexed.ok) return refused("erasure-rehearsal", workspaceId, indexed.error, io);
  if (indexed.value.status !== "done") {
    io.say(
      `erasure-rehearsal: REFUSED — the synthetic subject's document is not indexed: job ${indexJobId} is ${unfinished(indexed.value, waitSeconds, "no worker has indexed it")}`,
    );
    return REFUSED;
  }
  io.say(
    `erasure-rehearsal: done — the synthetic subject of ${workspaceId} is seeded (a user row, an Admin member, one concept file and one indexed document naming them); take the dump, then run phase two`,
  );
  io.say(seeded.value.tokens.join(","));
  return DONE;
};

type RehearsalAsked =
  | { readonly phase: "seed"; readonly waitSeconds: number }
  | { readonly phase: "run"; readonly reportPath: string };

const WAIT_SECONDS_MALFORMED = "--wait-seconds takes a whole number of seconds";

export const rehearsalAskedOf = (flags: Flags): Result<RehearsalAsked, string> => {
  if (flags.get("synthetic") !== true) {
    return err(
      "--synthetic is required — this command creates a synthetic subject and then erases them, and the flag is the caller saying this workspace is somewhere that may happen",
    );
  }
  const seeding = flags.get("seed") === true;
  if (seeding === (flags.get("run") === true)) {
    return err(
      "exactly one of --seed (phase one) or --run --report <file> (phase two); the drill takes a dump between them",
    );
  }
  const wait = waitSecondsOf(flags);
  if (seeding) {
    return wait === "malformed"
      ? err(WAIT_SECONDS_MALFORMED)
      : ok({ phase: "seed", waitSeconds: wait ?? WAIT_SECONDS });
  }
  const reportPath = flagValue(flags, "report");
  if (reportPath === undefined) {
    return err(
      "--run needs --report <file> — the report is what the drill keeps, and a run whose report went nowhere proved nothing",
    );
  }
  return wait === "malformed" ? err(WAIT_SECONDS_MALFORMED) : ok({ phase: "run", reportPath });
};

const erasedToTheReport = async (
  erasure: ErasureDoors,
  workspaceId: string,
  reportPath: string,
  io: OpsIo,
): Promise<number> => {
  const rehearsed = await rehearseErasure(ERASURE, erasure, { workspaceId });
  if (!rehearsed.ok) {
    return refused(
      "erasure-rehearsal",
      workspaceId,
      rehearsed.error,
      io,
      rehearsalSaid(rehearsed.error),
    );
  }
  const written = await writeTheReport(reportPath, rehearsed.value.report, io);
  if (written !== undefined) {
    io.say(
      `erasure-rehearsal: REFUSED — the erasure ran and completed at ${rehearsed.value.completedAt.toISOString()}, but its report could not be written to ${reportPath}: ${written}`,
    );
    return REFUSED;
  }
  io.say(
    `erasure-rehearsal: done — erased the synthetic subject of ${workspaceId} under request ${rehearsed.value.subjectRequestId}; the report is at ${reportPath}`,
  );
  io.say(rehearsed.value.tokens.join(","));
  return DONE;
};

export const erasureRehearsal = async (
  doors: Doors,
  workspaceId: string,
  rehearsal: RehearsalAsked,
  io: OpsIo,
): Promise<number> => {
  const opened = erasureDoors(doors, io.logger);
  if (!opened.ok) {
    io.say(`erasure-rehearsal: REFUSED — ${opened.error}`);
    return REFUSED;
  }
  if (rehearsal.phase === "seed") {
    return seedingToBeDumped(doors, opened.value, workspaceId, rehearsal.waitSeconds, io);
  }
  return erasedToTheReport(opened.value, workspaceId, rehearsal.reportPath, io);
};

const writeTheReport = async (
  path: string,
  body: string,
  io: OpsIo,
): Promise<string | undefined> => {
  if (io.writeReport === undefined) {
    return "this process has no way to write a file, which is a wiring fault and not an operator's";
  }
  try {
    await io.writeReport(path, body);
    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
};
