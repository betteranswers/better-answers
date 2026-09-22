import { boundarySchemas } from "@better-answers/schema";

import { attempt, err, ok, type PlatformPrincipal, type Result } from "../kernel/index.ts";
import {
  listWorkspaceObjects,
  removeWorkspaceObject,
  type ObjectDoor,
} from "../store/objects/index.ts";
import { withScope, type PostgresDoor } from "../store/postgres/index.ts";
import { UPLOAD_ORIGINALS_PREFIX } from "./binding.ts";

const UPLOAD_SWEEP_ACTOR = "process:better-answers-uploads";

export type UploadSweepPrincipal = PlatformPrincipal & {
  readonly actorId: typeof UPLOAD_SWEEP_ACTOR;
};

export const UPLOAD_SWEEP: UploadSweepPrincipal = {
  kind: "platform",
  actorId: UPLOAD_SWEEP_ACTOR,
};

export const ORPHANED_UPLOAD_GRACE_HOURS = 24;

const AN_HOUR_MS = 60 * 60 * 1000;

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

export const sweepOrphanedUploads = async (
  platform: UploadSweepPrincipal,
  doors: { readonly postgres: PostgresDoor; readonly objects: ObjectDoor },
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

  const stored = await attempt(() =>
    listWorkspaceObjects(platform, doors.objects, workspaceId, UPLOAD_ORIGINALS_PREFIX),
  );
  if (!stored.ok) return err(stored.error);
  if (!stored.value.ok) {
    return err(new Error(`sources: the originals' prefix was refused (${stored.value.error})`));
  }

  const before = input.now.getTime() - ORPHANED_UPLOAD_GRACE_HOURS * AN_HOUR_MS;
  const orphaned = stored.value.value.filter(
    (object) => !held.has(object.key) && object.storedAt.getTime() <= before,
  );
  if (input.dryRun === true) return ok({ found: orphaned.length, removed: 0 });

  for (const object of orphaned) {
    const gone = await attempt(() =>
      removeWorkspaceObject(platform, doors.objects, workspaceId, object.key),
    );
    if (!gone.ok) return err(gone.error);
    if (!gone.value.ok) {
      return err(
        new Error(`sources: an orphaned original's key was refused (${gone.value.error})`),
      );
    }
  }
  return ok({ found: orphaned.length, removed: orphaned.length });
};
