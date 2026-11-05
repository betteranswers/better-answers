import { err, ok, type Result } from "@better-answers/core/kernel";
import {
  ORPHANED_UPLOAD_GRACE_HOURS,
  REINDEX,
  reindexEveryConnectedSource,
  sweepOrphanedUploads,
  UPLOAD_SWEEP,
} from "@better-answers/core/sources";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";

import { doorTold, type Doors } from "../doors.ts";
import { DONE, REFUSED, type OpsIo, type Flags, refused, counted } from "./cli.ts";

export const reindexConnectedSources = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const reindexed = await reindexEveryConnectedSource(REINDEX, doors.postgres, { workspaceId });
  if (!reindexed.ok) return refused("reindex-connected-sources", workspaceId, reindexed.error, io);
  if (reindexed.value.length === 0) {
    io.say("reindex-connected-sources: done — the workspace has no connected sources to reindex");
    return DONE;
  }
  const passages = reindexed.value.reduce((total, source) => total + source.passages, 0);
  io.say(
    `reindex-connected-sources: done — cleared ${counted(reindexed.value.length, "connected source")} (${counted(passages, "passage")}). Each is queued to index again.`,
  );
  return DONE;
};

type ObjectStoreOrphansAsked = { readonly list: boolean };

export const objectStoreOrphansAskedOf = (
  flags: Flags,
): Result<ObjectStoreOrphansAsked, string> => {
  const listing = flags.get("list");
  if (listing !== undefined && listing !== true) return err("--list takes no value");
  return ok({ list: listing === true });
};

export const objectStoreOrphans = async (
  doors: Doors,
  workspaceId: string,
  { list }: ObjectStoreOrphansAsked,
  io: OpsIo,
): Promise<number> => {
  const objects = doorTold(
    doors.objects,
    "the object store is not configured, so the files that failed connects left cannot be reached. Set S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY and S3_SECRET_KEY on the api service.",
  );
  if (!objects.ok) {
    io.say(`object-store-orphans: REFUSED — ${objects.error}`);
    return REFUSED;
  }
  const swept = await withSweepLock(SWEEPS, doors.postgres, () =>
    sweepOrphanedUploads(
      UPLOAD_SWEEP,
      { postgres: doors.postgres, objects: objects.value },
      { workspaceId, now: doors.clock.now(), dryRun: list },
    ),
  );
  if (!swept.ok) return refused("object-store-orphans", workspaceId, swept.error, io);
  const orphans = `older than ${ORPHANED_UPLOAD_GRACE_HOURS} hours that no document names`;
  io.say(
    list
      ? `object-store-orphans: done — found ${counted(swept.value.found, "object")} ${orphans}, and removed none`
      : `object-store-orphans: done — removed ${counted(swept.value.removed, "object")} ${orphans}`,
  );
  return DONE;
};
