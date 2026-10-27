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
  processActorId,
  ulid,
  type Clock,
  type PlatformPrincipal,
  type Result,
  type WorkspaceId,
} from "../kernel/index.ts";
import { settleExpiredSpend } from "../llm/index.ts";
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

const SWEEPS_ACTOR = processActorId("sweeps");

export type SweepsPrincipal = PlatformPrincipal & {
  readonly actorId: typeof SWEEPS_ACTOR;
};

export const SWEEPS: SweepsPrincipal = { kind: "platform", actorId: SWEEPS_ACTOR };

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
  readonly spend: Result<number>;
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
  for (const { uploads, map, spend } of swept) {
    if (!uploads.ok || !map.ok || !spend.ok) refused += 1;
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

const recordThePass = async (
  door: PostgresDoor,
  uploadSweep: UploadSweepMode,
  totals: SweepTotals,
): Promise<Result<void>> => {
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
  platform: SweepsPrincipal,
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
  spend: await settleExpiredSpend(platform, doors.postgres, {
    workspaceId,
    now: doors.clock.now(),
  }),
});

export const sweepEveryWorkspace = async (
  platform: SweepsPrincipal,
  doors: SweepDoors,
  input: { readonly uploadSweep: UploadSweepMode },
): Promise<Result<SweepPass, LockHeld | Error>> => {
  const locked = await withSessionTryLock(
    platform,
    doors.postgres,
    SWEEP_LOCK,
    async (): Promise<Result<SweepPass>> => {
      const listed = await workspaceIds(platform, doors.postgres);
      if (!listed.ok) return err(listed.error);
      const swept: WorkspaceSwept[] = [];
      for (const workspaceId of listed.value) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- every workspace's sweep at once would hold a pool connection each
        swept.push(await sweepOne(platform, doors, workspaceId, input.uploadSweep));
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
 * A run by hand waits for a pass that holds the lock rather than skipping.
 */
export const withSweepLock = <T>(
  platform: SweepsPrincipal,
  door: PostgresDoor,
  work: () => Promise<T>,
): Promise<T> => withSessionLock(platform, door, SWEEP_LOCK, () => work());

const ISO_DAY = "yyyy-mm-dd";

const firstOfTheMonth = (now: Date, monthsOn: number): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsOn, 1))
    .toISOString()
    .slice(0, ISO_DAY.length);

export const makeQuestionMonths = (
  door: PostgresDoor,
  input: { readonly now: Date },
): Promise<Result<void>> =>
  attempt(async () => {
    for (const monthsOn of [0, 1]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the maker takes one advisory lock with a short lock timeout, so a second call only queues
      await door.pool.query("SELECT create_question_content_partition($1)", [
        firstOfTheMonth(input.now, monthsOn),
      ]);
    }
  });

const VERIFICATION_KEPT_PAST_EXPIRY_MS = 24 * 60 * 60 * 1000;

const INGRESS_WINDOW_KEPT_MS = 24 * 60 * 60 * 1000;

const EXPIRED_SESSIONS = "DELETE FROM session WHERE expires_at < $1 OR pending_since < $2";

const EXPIRED_VERIFICATIONS = "DELETE FROM verification WHERE expires_at < $1";

export type IdentitySetSwept = {
  readonly sessions: Result<number>;
  readonly verifications: Result<number>;
  readonly ingressWindows: Result<number>;
};

const before = (now: Date, ms: number): Date => new Date(now.getTime() - ms);

const countDeleted = (
  platform: SweepsPrincipal,
  door: PostgresDoor,
  statement: string,
  cutoffs: readonly Date[],
): Promise<Result<number>> =>
  attempt(async () => {
    const dropped = await withIdentityWrite(platform, door, (tx) =>
      tx.query(statement, [...cutoffs]),
    );
    return dropped.rowCount ?? 0;
  });

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
