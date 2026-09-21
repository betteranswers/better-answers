import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, record, type DetailOf } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  ulid,
  type Clock,
  type PlatformPrincipal,
  type Result,
} from "../kernel/index.ts";
import type { GitDoor } from "../store/git/index.ts";
import type { ObjectDoor } from "../store/objects/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { workspaceIds } from "../workspaces/index.ts";
import { replayCopiesSince, type ReplayCopy } from "./replay.ts";
import { dueDateOf } from "./requests.ts";
import { beyondUseFrom, runErasure, type ErasurePrincipal } from "./routine.ts";

const REPLAY_ACTS = declareActs("platform", {
  replayed: act("platform.erasure.replayed", {
    erasureRequestId: "id",
    subjectRequestId: "id",
    fromReplayCopy: "flag",
  }),
});

type ReplayedDetail = DetailOf<(typeof REPLAY_ACTS)["replayed"]["detail"]>;

export type ReplayableErasure = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  readonly completedAt: Date;

  readonly copy?: ReplayCopy;
};

export type ReplayedErasure = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;

  readonly completedAt: Date;

  readonly fromReplayCopy: boolean;

  readonly auditEventId: string;
};

export type ReplayDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
};

type CompletedRow = {
  readonly id: string;
  readonly subject_request_id: string;
  readonly completed_at: Date;
};

export const erasureRequestsSince = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  since: Date,
): Promise<Result<readonly ReplayableErasure[], Error>> => {
  const held = await workspaceIds(platform, door);
  if (!held.ok) return err(held.error);

  const found: ReplayableErasure[] = [];
  for (const workspaceId of held.value) {
    const read = await attempt(() =>
      withScope(platform, door, workspaceId, (tx: Tx) =>
        tx.query<CompletedRow>(
          `SELECT id, subject_request_id, completed_at
             FROM erasure_request
            WHERE workspace_id = $1 AND completed_at > $2`,
          [workspaceId, since],
        ),
      ),
    );
    if (!read.ok) return err(read.error);
    for (const row of read.value.rows) {
      found.push({
        workspaceId,

        subjectRequestId: boundarySchemas.subjectRequest.select.shape.id.parse(
          row.subject_request_id,
        ),
        erasureRequestId: boundarySchemas.erasureRequest.select.shape.id.parse(row.id),
        completedAt: row.completed_at,
      });
    }
  }
  return ok(found);
};

export const replayableErasures = async (
  platform: PlatformPrincipal,
  doors: Pick<ReplayDoors, "postgres" | "objects">,
  input: { readonly since: Date },
): Promise<Result<readonly ReplayableErasure[], Error>> => {
  const rows = await erasureRequestsSince(platform, doors.postgres, input.since);
  if (!rows.ok) return err(rows.error);
  const copies = await replayCopiesSince(platform, doors.objects, input.since);
  if (!copies.ok) return err(copies.error);

  const byRequest = new Map<string, ReplayableErasure>();
  for (const row of rows.value) byRequest.set(row.erasureRequestId, row);
  for (const copy of copies.value) {
    if (byRequest.has(copy.erasureRequestId)) continue;
    byRequest.set(copy.erasureRequestId, {
      workspaceId: copy.workspaceId,
      subjectRequestId: copy.subjectRequestId,
      erasureRequestId: copy.erasureRequestId,
      completedAt: new Date(copy.completedAt),
      copy,
    });
  }

  return ok(
    [...byRequest.values()].sort(
      (one, other) =>
        one.completedAt.getTime() - other.completedAt.getTime() ||
        one.erasureRequestId.localeCompare(other.erasureRequestId),
    ),
  );
};

const EMPTY_SET = { emails: [], names: [], other: [] };

export const restoreFromReplayCopy = async (
  platform: ErasurePrincipal,
  door: PostgresDoor,
  copy: ReplayCopy,
): Promise<Result<void, Error>> => {
  const receivedAt = new Date(copy.completedAt);
  const beyondUse = beyondUseFrom(receivedAt);
  const restored = await attempt(() =>
    withScope(platform, door, copy.workspaceId, async (tx) => {
      await tx.query(
        `INSERT INTO subject_request
           (workspace_id, id, person_id, identifiers, kind, received_at, clock_started_at, due_at)
         VALUES ($1, $2, $3, $4, 'erasure', $5, $5, $6)
         ON CONFLICT (workspace_id, id) DO NOTHING`,
        [
          copy.workspaceId,
          copy.subjectRequestId,

          copy.personId ?? null,
          copy.identifiers ?? EMPTY_SET,
          receivedAt,
          dueDateOf(receivedAt),
        ],
      );
      await tx.query(
        `INSERT INTO erasure_request
           (workspace_id, id, subject_request_id, pseudonym, locked_at, anchored_at,
            beyond_use_hourly_at, beyond_use_daily_at, beyond_use_weekly_at,
            beyond_use_monthly_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, subject_request_id) DO NOTHING`,
        [
          copy.workspaceId,
          copy.erasureRequestId,
          copy.subjectRequestId,
          copy.pseudonym,
          receivedAt,
          beyondUse.hourly,
          beyondUse.daily,
          beyondUse.weekly,
          beyondUse.monthly,
        ],
      );
    }),
  );
  return restored.ok ? ok(undefined) : err(restored.error);
};

const detailOf = (erasure: ReplayableErasure): ReplayedDetail => ({
  erasureRequestId: erasure.erasureRequestId,
  subjectRequestId: erasure.subjectRequestId,
  fromReplayCopy: erasure.copy !== undefined,
});

const recordTheReplay = async (
  platform: ErasurePrincipal,
  door: PostgresDoor,
  erasure: ReplayableErasure,
): Promise<string> => {
  const auditEventId = ulid();
  await withScope(platform, door, erasure.workspaceId, (tx) =>
    record(platform, tx, {
      id: auditEventId,
      act: REPLAY_ACTS.replayed,
      subjectId: erasure.erasureRequestId,
      detail: detailOf(erasure),
    }),
  );
  return auditEventId;
};

export const replayErasures = async (
  platform: ErasurePrincipal,
  doors: ReplayDoors,
  input: { readonly since: Date },
): Promise<Result<readonly ReplayedErasure[], Error>> => {
  const owed = await replayableErasures(platform, doors, input);
  if (!owed.ok) return err(owed.error);

  const replayed: ReplayedErasure[] = [];
  for (const erasure of owed.value) {
    const stopped = (cause: unknown): Error =>
      new Error(
        `erasure: the replay stopped at ${erasure.erasureRequestId} in workspace ` +
          `${erasure.workspaceId} after replaying ${String(replayed.length)}: ${String(cause)}`,
      );

    if (erasure.copy !== undefined) {
      const restored = await restoreFromReplayCopy(platform, doors.postgres, erasure.copy);
      if (!restored.ok) return err(stopped(restored.error));
    }

    const run = await runErasure(platform, doors, {
      workspaceId: erasure.workspaceId,
      subjectRequestId: erasure.subjectRequestId,
    });
    if (!run.ok) return err(stopped(run.error));

    const recorded = await attempt(() => recordTheReplay(platform, doors.postgres, erasure));
    if (!recorded.ok) return err(stopped(recorded.error));

    replayed.push({
      workspaceId: erasure.workspaceId,
      subjectRequestId: erasure.subjectRequestId,
      erasureRequestId: erasure.erasureRequestId,
      completedAt: run.value.completedAt,
      fromReplayCopy: erasure.copy !== undefined,
      auditEventId: recorded.value,
    });
  }
  return ok(replayed);
};
