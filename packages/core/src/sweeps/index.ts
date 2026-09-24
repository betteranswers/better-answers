import type { UPLOAD_SWEEP_MODES } from "@better-answers/schema";

import {
  GRAPH_MAINTENANCE,
  sweepGraph,
  type GraphMaintenanceRefusal,
  type SweptGeneration,
} from "../concepts/index.ts";
import {
  attempt,
  err,
  ok,
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

// Holds the lock and lists the workspaces; each sweep still runs, and is audited, as its own
// actor, the same as a run by hand.
export const SWEEPS: SweepsPrincipal = { kind: "platform", actorId: SWEEPS_ACTOR };

// 41 is the dump's, which the erasure routine and the backup job share.
const SWEEP_LOCK = 42;

export type UploadSweepMode = (typeof UPLOAD_SWEEP_MODES)[number];

export type SweepDoors = {
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
};

type WorkspaceSwept = {
  readonly workspaceId: WorkspaceId;
  readonly uploads: Result<SweptUploads, SweepUploadsRefusal>;
  readonly graph: Result<readonly SweptGeneration[], GraphMaintenanceRefusal | Error>;
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
  for (const { uploads, graph } of swept) {
    if (!uploads.ok || !graph.ok) refused += 1;
    if (uploads.ok) {
      found += uploads.value.found;
      removed += uploads.value.removed;
    }
    if (graph.ok) generations += graph.value.length;
  }
  return { workspaces: swept.length, refused, found, removed, generations };
};

const RECORD_THE_PASS = `INSERT INTO sweep_pass
    (id, upload_sweep, workspaces, refused, found, removed, generations)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

// One statement and no scope: the row names no workspace, so no transaction is needed around it.
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
  graph: await sweepGraph(GRAPH_MAINTENANCE, doors.postgres, { workspaceId }),
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

// A run by hand waits for a pass that holds the lock rather than skipping, since a person
// asked for it.
export const withSweepLock = <T>(
  platform: SweepsPrincipal,
  door: PostgresDoor,
  work: () => Promise<T>,
): Promise<T> => withSessionLock(platform, door, SWEEP_LOCK, () => work());
