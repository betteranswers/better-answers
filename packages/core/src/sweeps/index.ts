import type { UPLOAD_SWEEP_MODES } from "@better-answers/schema";

import {
  MAP_MAINTENANCE,
  sweepMap,
  type MapMaintenanceRefusal,
  type SweptGeneration,
} from "../concepts/index.ts";
import {
  attempt,
  err,
  ok,
  PENDING_SESSION_LIFETIME_MS,
  ulid,
  type Clock,
  type PlatformPrincipal,
  type Result,
  type WorkspaceId,
} from "../kernel/index.ts";
import {
  sweepOrphanedUploads,
  UPLOAD_SWEEP,
  type SweepUploadsRefusal,
  type SweptUploads,
} from "../sources/index.ts";
import type { ObjectDoor } from "../store/objects/index.ts";
import {
  dropIngressWindowsBefore,
  withIdentityWrite,
  withSessionLock,
  withSessionTryLock,
  type LockHeld,
  type PostgresDoor,
} from "../store/postgres/index.ts";
import { workspaceIds } from "../workspaces/index.ts";

const SWEEPS_ACTOR = "process:better-answers-sweeps";

export type SweepsPrincipal = PlatformPrincipal & {
  readonly actorId: typeof SWEEPS_ACTOR;
};

/**
 * Holds the lock and lists the workspaces; each sweep still runs, and is audited, as its own
 * actor, the same as a run by hand.
 */
export const SWEEPS: SweepsPrincipal = { kind: "platform", actorId: SWEEPS_ACTOR };

/** 41 is the dump's, which the erasure routine and the backup job share. */
const SWEEP_LOCK = 42;

/** `list` finds the orphaned uploads and removes none; `remove` removes them. */
export type UploadSweepMode = (typeof UPLOAD_SWEEP_MODES)[number];

export type SweepDoors = {
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
};

type WorkspaceSwept = {
  readonly workspaceId: WorkspaceId;
  readonly uploads: Result<SweptUploads, SweepUploadsRefusal>;
  readonly map: Result<readonly SweptGeneration[], MapMaintenanceRefusal | Error>;
};

type SweepTotals = {
  readonly workspaces: number;

  readonly refused: number;

  readonly found: number;
  readonly removed: number;

  readonly generations: number;
};

export type SweepPass = {
  readonly uploadSweep: UploadSweepMode;
  readonly totals: SweepTotals;
  readonly swept: readonly WorkspaceSwept[];
};

const totalsOf = (swept: readonly WorkspaceSwept[]): SweepTotals => {
  let refused = 0;
  let found = 0;
  let removed = 0;
  let generations = 0;
  for (const { uploads, map } of swept) {
    if (!uploads.ok || !map.ok) refused += 1;
    if (uploads.ok) {
      found += uploads.value.found;
      removed += uploads.value.removed;
    }
    if (map.ok) generations += map.value.length;
  }
  return { workspaces: swept.length, refused, found, removed, generations };
};

const RECORD_THE_PASS = `INSERT INTO sweep_pass
    (id, upload_sweep, workspaces, refused, found, removed, generations)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

/**
 * One statement and no scope: the row names no workspace, so no transaction is needed around it.
 */
const recordThePass = async (
  door: PostgresDoor,
  uploadSweep: UploadSweepMode,
  totals: SweepTotals,
): Promise<Result<void, Error>> => {
  const { workspaces, refused, found, removed, generations } = totals;
  const written = await attempt(() =>
    door.pool.query(RECORD_THE_PASS, [
      ulid(),
      uploadSweep,
      workspaces,
      refused,
      found,
      removed,
      generations,
    ]),
  );
  if (written.ok) return ok(undefined);
  return err(
    new Error(`sweeps: the pass swept, but its row was not written: ${written.error.message}`),
  );
};

const sweepOne = async (
  doors: SweepDoors,
  workspaceId: WorkspaceId,
  uploadSweep: UploadSweepMode,
): Promise<WorkspaceSwept> => ({
  workspaceId,
  uploads: await sweepOrphanedUploads(
    UPLOAD_SWEEP,
    { postgres: doors.postgres, objects: doors.objects },
    { workspaceId, now: doors.clock.now(), dryRun: uploadSweep === "list" },
  ),
  map: await sweepMap(MAP_MAINTENANCE, doors.postgres, { workspaceId }),
});

/**
 * Answers `held` at once when another pass holds the lock. A workspace whose sweep is refused is
 * counted in `refused` and the pass goes on. Writes one `sweep_pass` row; failing to write it
 * fails the pass, though every sweep ran.
 */
export const sweepEveryWorkspace = async (
  platform: SweepsPrincipal,
  doors: SweepDoors,
  input: { readonly uploadSweep: UploadSweepMode },
): Promise<Result<SweepPass, LockHeld | Error>> => {
  const locked = await withSessionTryLock(
    platform,
    doors.postgres,
    SWEEP_LOCK,
    async (): Promise<Result<SweepPass, Error>> => {
      const listed = await workspaceIds(platform, doors.postgres);
      if (!listed.ok) return err(listed.error);
      const swept: WorkspaceSwept[] = [];
      for (const workspaceId of listed.value) {
        swept.push(await sweepOne(doors, workspaceId, input.uploadSweep));
      }
      const totals = totalsOf(swept);
      const recorded = await recordThePass(doors.postgres, input.uploadSweep, totals);
      if (!recorded.ok) return err(recorded.error);
      return ok({ uploadSweep: input.uploadSweep, totals, swept });
    },
  );
  return locked.ok ? locked.value : err(locked.error);
};

/**
 * A run by hand waits for a pass that holds the lock rather than skipping, since a person
 * asked for it.
 */
export const withSweepLock = <T>(
  platform: SweepsPrincipal,
  door: PostgresDoor,
  work: () => Promise<T>,
): Promise<T> => withSessionLock(platform, door, SWEEP_LOCK, () => work());

/** Past any wait to type a code from an email, so one that expired just before a pass reads as spent. */
const VERIFICATION_KEPT_PAST_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Far past the longest ingress rule's window, an hour, so no live count goes. */
const INGRESS_WINDOW_KEPT_MS = 24 * 60 * 60 * 1000;

const EXPIRED_SESSIONS = "DELETE FROM session WHERE expires_at < $1 OR pending_since < $2";

const EXPIRED_VERIFICATIONS = "DELETE FROM verification WHERE expires_at < $1";

export type IdentitySetSwept = {
  readonly sessions: Result<number, Error>;
  readonly verifications: Result<number, Error>;
  readonly ingressWindows: Result<number, Error>;
};

const before = (now: Date, ms: number): Date => new Date(now.getTime() - ms);

const countDeleted = (
  platform: SweepsPrincipal,
  door: PostgresDoor,
  statement: string,
  cutoffs: readonly Date[],
): Promise<Result<number, Error>> =>
  attempt(async () => {
    const dropped = await withIdentityWrite(platform, door, (tx) =>
      tx.query(statement, [...cutoffs]),
    );
    return dropped.rowCount ?? 0;
  });

/**
 * Deletes sessions past their expiry or their pending hour, verification rows a day past expiry,
 * and ingress windows a day old. Each delete stands alone, so a refused one keeps no other's
 * rows. Failed-confirm counts stay: deleting one would reset a person's backoff.
 */
export const sweepIdentitySet = async (
  platform: SweepsPrincipal,
  door: PostgresDoor,
  input: { readonly now: Date },
): Promise<IdentitySetSwept> => ({
  sessions: await countDeleted(platform, door, EXPIRED_SESSIONS, [
    input.now,
    before(input.now, PENDING_SESSION_LIFETIME_MS),
  ]),
  verifications: await countDeleted(platform, door, EXPIRED_VERIFICATIONS, [
    before(input.now, VERIFICATION_KEPT_PAST_EXPIRY_MS),
  ]),
  ingressWindows: await attempt(() =>
    dropIngressWindowsBefore(door, before(input.now, INGRESS_WINDOW_KEPT_MS)),
  ),
});
