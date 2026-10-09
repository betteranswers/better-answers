import { action, declareActions, record, STORED_DETAIL_KEYS } from "../audit/index.ts";
import {
  attempt,
  attemptResult,
  err,
  normalizeError,
  ok,
  ulid,
  type PlatformPrincipal,
  type Result,
  type WorkspaceId,
} from "../kernel/index.ts";
import { endedSyncs, lockSyncIn, type EndedSync } from "../runs/index.ts";
import {
  scopeClause,
  scopeParameter,
  withScope,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";
import { workspaceIds } from "../workspaces/index.ts";
import { cascadingVisibility } from "./visibility.ts";

const SYNC_CASCADE_ACTOR = "process:better-answers-sync-cascade";

export type SyncCascadePrincipal = PlatformPrincipal & {
  readonly actorId: typeof SYNC_CASCADE_ACTOR;
};

export const SYNC_CASCADE: SyncCascadePrincipal = { kind: "platform", actorId: SYNC_CASCADE_ACTOR };

/** One event per sync and attempt: it is how the tick knows that attempt is handled. */
export const SYNC_CASCADE_ACTIONS = declareActions("platform", {
  followed: action("platform.job.followed", {
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    attempts: "count",
    documents: "count",
    concepts: "count",
    writeUps: "count",
  }),
});

/** What the marker read answers for a sync and attempt already followed. */
const ALREADY_FOLLOWED = "followed";

/** A finish stamp is taken before its commit lands, so the scan reaches back past the first event. */
const SCAN_MARGIN_MS = 60 * 60 * 1000;

type SyncFollowed = {
  readonly jobId: string;
  readonly concepts: number;
};

type SyncSkipped = {
  readonly jobId: string;
  readonly reason: string;
};

export type WorkspaceSyncsFollowed = {
  readonly workspaceId: WorkspaceId;
  readonly followed: readonly SyncFollowed[];
  readonly skipped: readonly SyncSkipped[];
};

const firstFollowedAt = async (platform: SyncCascadePrincipal, tx: Tx): Promise<Date | null> => {
  const first = await tx.query<{ at: Date | null }>(
    `SELECT min(at) AS at FROM audit_event
      WHERE workspace_id = ${scopeClause(1)} AND actor = $2 AND action = $3`,
    [scopeParameter(platform), platform.actorId, SYNC_CASCADE_ACTIONS.followed.name],
  );
  return first.rows[0]?.at ?? null;
};

const followedKey = (sync: Pick<EndedSync, "jobId" | "attempts">): string =>
  `${sync.jobId}:${String(sync.attempts)}`;

/** Each listed sync and attempt that already has its event, as `followedKey` spells it. */
const followedAmong = async (
  platform: SyncCascadePrincipal,
  tx: Tx,
  syncs: readonly EndedSync[],
): Promise<ReadonlySet<string>> => {
  const known = await tx.query<{ subject_id: string; attempts: number }>(
    `SELECT subject_id, (detail ->> 'attempts')::int AS attempts FROM audit_event
      WHERE workspace_id = ${scopeClause(1)} AND subject_kind = 'job'
        AND subject_id = ANY($2::text[]) AND action = $3`,
    [scopeParameter(platform), syncs.map((sync) => sync.jobId), SYNC_CASCADE_ACTIONS.followed.name],
  );
  return new Set(
    known.rows.map((row) => followedKey({ jobId: row.subject_id, attempts: row.attempts })),
  );
};

const targetOf = (sync: EndedSync) =>
  sync.moved.kind === "documents"
    ? { connectedSourceId: sync.connectedSourceId, documentIds: sync.moved.documentIds }
    : { connectedSourceId: sync.connectedSourceId };

/** Locks a lapsed claim's row so its revoked claimant cannot write after us; reads the marker under the cascade lock, so replicas serialise. */
const unlessFollowed =
  (platform: SyncCascadePrincipal, workspaceId: WorkspaceId, sync: EndedSync) =>
  async (tx: Tx): Promise<Result<undefined, typeof ALREADY_FOLLOWED | Error>> => {
    if (sync.status === "claimed") {
      const locked = await lockSyncIn(platform, tx, {
        workspaceId,
        jobId: sync.jobId,
        attempts: sync.attempts,
      });
      if (!locked.ok) return err(normalizeError(locked.error));
    }
    const known = await attempt(() => followedAmong(platform, tx, [sync]));
    if (!known.ok) return err(known.error);
    return known.value.has(followedKey(sync)) ? err(ALREADY_FOLLOWED) : ok(undefined);
  };

const followSync = async (
  platform: SyncCascadePrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  sync: EndedSync,
): Promise<Result<number | undefined, Error>> =>
  attemptResult(() =>
    withScope(
      platform,
      door,
      workspaceId,
      async (tx): Promise<Result<number | undefined, Error>> => {
        const cascaded = await cascadingVisibility(
          platform,
          tx,
          targetOf(sync),
          unlessFollowed(platform, workspaceId, sync),
        );
        if (!cascaded.ok)
          return cascaded.error === ALREADY_FOLLOWED ? ok(undefined) : err(cascaded.error);
        await record(platform, tx, {
          id: ulid(),
          action: SYNC_CASCADE_ACTIONS.followed,
          subjectId: sync.jobId,
          detail: {
            [STORED_DETAIL_KEYS.connectedSourceId]: sync.connectedSourceId,
            attempts: sync.attempts,
            documents: sync.moved.kind === "documents" ? sync.moved.documentIds.length : 0,
            concepts: cascaded.value.concepts.length,
            writeUps: cascaded.value.writeUps.length,
          },
        });
        return ok(cascaded.value.concepts.length);
      },
    ),
  );

/** Each source's newest sync stays listed until followed, so a first-pass failure is not lost behind the baseline. */
const listedSyncs = async (
  platform: SyncCascadePrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  firstFollowed: Date | null,
): Promise<Result<readonly EndedSync[], Error>> => {
  const newest = await endedSyncs(platform, door, {
    workspaceId,
    scan: { kind: "newest-per-source" },
  });
  if (!newest.ok) return err(normalizeError(newest.error));
  if (firstFollowed === null) return ok(newest.value);
  const since = await endedSyncs(platform, door, {
    workspaceId,
    scan: { kind: "ended-since", at: new Date(firstFollowed.getTime() - SCAN_MARGIN_MS) },
  });
  if (!since.ok) return err(normalizeError(since.error));
  const byKey = new Map([...newest.value, ...since.value].map((sync) => [followedKey(sync), sync]));
  return ok(
    [...byKey.values()].toSorted(
      (a, b) => a.endedAt.getTime() - b.endedAt.getTime() || a.jobId.localeCompare(b.jobId),
    ),
  );
};

const syncsToFollow = async (
  platform: SyncCascadePrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
): Promise<Result<readonly EndedSync[], Error>> => {
  const first = await attempt(() =>
    withScope(platform, door, workspaceId, (tx) => firstFollowedAt(platform, tx)),
  );
  if (!first.ok) return err(first.error);
  const listed = await listedSyncs(platform, door, workspaceId, first.value);
  if (!listed.ok) return err(listed.error);
  // Rules out what is already followed without a transaction per sync; the marker read under the lock still decides.
  const followed = await attempt(() =>
    withScope(platform, door, workspaceId, (tx) => followedAmong(platform, tx, listed.value)),
  );
  if (!followed.ok) return err(followed.error);
  return ok(listed.value.filter((sync) => !followed.value.has(followedKey(sync))));
};

/** One transaction per sync. A sync that fails is skipped and named, then tried again next pass. */
export const followSyncs = async (
  platform: SyncCascadePrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
): Promise<Result<WorkspaceSyncsFollowed, Error>> => {
  const syncs = await syncsToFollow(platform, door, workspaceId);
  if (!syncs.ok) return err(syncs.error);
  const followed: SyncFollowed[] = [];
  const skipped: SyncSkipped[] = [];
  for (const sync of syncs.value) {
    const outcome = await followSync(platform, door, workspaceId, sync);
    if (!outcome.ok) skipped.push({ jobId: sync.jobId, reason: outcome.error.message });
    else if (outcome.value !== undefined)
      followed.push({ jobId: sync.jobId, concepts: outcome.value });
  }
  return ok({ workspaceId, followed, skipped });
};

export const followSyncsInEveryWorkspace = async (
  platform: SyncCascadePrincipal,
  door: PostgresDoor,
): Promise<Result<readonly Result<WorkspaceSyncsFollowed, Error>[], Error>> => {
  const held = await workspaceIds(platform, door);
  if (!held.ok) return err(held.error);
  const passes: Result<WorkspaceSyncsFollowed, Error>[] = [];
  for (const workspaceId of held.value) passes.push(await followSyncs(platform, door, workspaceId));
  return ok(passes);
};
