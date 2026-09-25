import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, record } from "../audit/index.ts";
import { attempt, err, ok, ulid, type PlatformPrincipal, type Result } from "../kernel/index.ts";
import {
  listWorkspaceObjects,
  removeWorkspaceObject,
  type ObjectDoor,
  type StoredObject,
} from "../store/objects/index.ts";
import { withScope, type PostgresDoor } from "../store/postgres/index.ts";
import { BINDING_ID } from "./admin-binding.ts";
import { UPLOAD_ORIGINALS_PREFIX } from "./binding.ts";

const UPLOAD_SWEEP_ACTOR = "process:better-answers-uploads";

export type UploadSweepPrincipal = PlatformPrincipal & {
  readonly actorId: typeof UPLOAD_SWEEP_ACTOR;
};

export const UPLOAD_SWEEP: UploadSweepPrincipal = {
  kind: "platform",
  actorId: UPLOAD_SWEEP_ACTOR,
};

const SWEEP_ACTS = declareActs("sources", {
  swept: act("sources.upload.swept", { bindingId: "id" }),
});

export const ORPHANED_UPLOAD_GRACE_HOURS = 24;

const AN_HOUR_MS = 60 * 60 * 1000;

const AN_ORIGINAL = /^uploads\/([^/]+)\/original$/;

const NAMED_ORIGINALS = `SELECT original_key FROM source_document
    WHERE workspace_id = $1 AND original_key IS NOT NULL`;

export type SweptUploads = {
  readonly found: number;

  readonly removed: number;
};

export type SweepUploadsInput = {
  readonly workspaceId: string;
  readonly now: Date;

  readonly dryRun?: boolean | undefined;
};

export type SweepUploadsRefusal = "malformed" | Error;

const bindingOfKey = (key: string): string | undefined => {
  const named = AN_ORIGINAL.exec(key)?.[1]?.toUpperCase();
  return named !== undefined && BINDING_ID.safeParse(named).success ? named : undefined;
};

const asDefect = async <Value, Word>(
  what: string,
  work: () => Promise<Result<Value, Word>>,
): Promise<Result<Value, Error>> => {
  const ran = await attempt(work);
  if (!ran.ok) return err(ran.error);
  if (ran.value.ok) return ok(ran.value.value);
  return err(new Error(`sources: ${what} (${String(ran.value.error)})`));
};

const recordTheSweep = async (
  platform: UploadSweepPrincipal,
  door: PostgresDoor,
  workspaceId: string,
  swept: readonly string[],
): Promise<Result<void, Error>> => {
  if (swept.length === 0) return ok(undefined);
  const batchId = swept.length > 1 ? ulid() : undefined;
  const written = await attempt(() =>
    withScope(platform, door, workspaceId, async (tx) => {
      for (const bindingId of swept) {
        await record(platform, tx, {
          id: ulid(),
          act: SWEEP_ACTS.swept,
          subjectId: bindingId,
          batchId,
          detail: { bindingId },
        });
      }
    }),
  );
  return written.ok ? ok(undefined) : err(written.error);
};

type SweepDoors = { readonly postgres: PostgresDoor; readonly objects: ObjectDoor };

type Orphan = { readonly key: string; readonly bindingId: string };

const orphansAmong = (
  stored: readonly StoredObject[],
  held: ReadonlySet<string>,
  before: number,
): readonly Orphan[] => {
  const orphaned: Orphan[] = [];
  for (const object of stored) {
    const bindingId = bindingOfKey(object.key);
    if (bindingId === undefined) continue;
    if (held.has(object.key) || object.storedAt.getTime() > before) continue;
    orphaned.push({ key: object.key, bindingId });
  }
  return orphaned;
};

const removeOrphans = async (
  platform: UploadSweepPrincipal,
  doors: SweepDoors,
  workspaceId: string,
  orphaned: readonly Orphan[],
): Promise<Result<number, Error>> => {
  const gone: string[] = [];
  for (const orphan of orphaned) {
    const removed = await asDefect("an orphaned original's key was refused", () =>
      removeWorkspaceObject(platform, doors.objects, workspaceId, orphan.key),
    );
    if (!removed.ok) {
      const kept = await recordTheSweep(platform, doors.postgres, workspaceId, gone);
      const unrecorded = kept.ok ? "" : `, and its ledger rows too: ${kept.error.message}`;
      return err(
        new Error(`${removed.error.message}; ${String(gone.length)} removed first${unrecorded}`),
      );
    }
    gone.push(orphan.bindingId);
  }
  const recorded = await recordTheSweep(platform, doors.postgres, workspaceId, gone);
  return recorded.ok ? ok(gone.length) : err(recorded.error);
};

/**
 * Removes each `uploads/<binding>/original` object that no document names once it is past the
 * grace hours, with a ledger row per removal. `dryRun` counts them and removes none. A failed
 * removal is an Error saying how many went before it.
 */
export const sweepOrphanedUploads = async (
  platform: UploadSweepPrincipal,
  doors: SweepDoors,
  input: SweepUploadsInput,
): Promise<Result<SweptUploads, SweepUploadsRefusal>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const workspaceId = workspace.data;

  const named = await attempt(() =>
    withScope(platform, doors.postgres, workspaceId, (tx) =>
      tx.query<{ original_key: string }>(NAMED_ORIGINALS, [workspaceId]),
    ),
  );
  if (!named.ok) return err(named.error);
  const held = new Set(named.value.rows.map((row) => row.original_key));

  const stored = await asDefect("the originals' prefix was refused", () =>
    listWorkspaceObjects(platform, doors.objects, workspaceId, UPLOAD_ORIGINALS_PREFIX),
  );
  if (!stored.ok) return err(stored.error);

  const before = input.now.getTime() - ORPHANED_UPLOAD_GRACE_HOURS * AN_HOUR_MS;
  const orphaned = orphansAmong(stored.value, held, before);
  if (input.dryRun === true) return ok({ found: orphaned.length, removed: 0 });

  const removed = await removeOrphans(platform, doors, workspaceId, orphaned);
  if (!removed.ok) return err(removed.error);
  return ok({ found: orphaned.length, removed: removed.value });
};
