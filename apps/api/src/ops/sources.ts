import {
  ORPHANED_UPLOAD_GRACE_HOURS,
  REINDEX,
  reindexEveryConnectedSource,
  sweepOrphanedUploads,
  UPLOAD_SWEEP,
} from "@better-answers/core/sources";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";

import { doorTold, type Doors } from "../doors.ts";
import { DONE, REFUSED, USAGE, type OpsIo, type Flags, refused, counted } from "./cli.ts";

export const reindexConnectedSources = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const reindexed = await reindexEveryConnectedSource(REINDEX, doors.postgres, { workspaceId });
  if (!reindexed.ok) return refused("reindex-connected-sources", workspaceId, reindexed.error, io);
  if (reindexed.value.length === 0) {
    io.say("reindex-connected-sources: done — no connected source to reindex");
    return DONE;
  }
  const passages = reindexed.value.reduce((total, source) => total + source.passages, 0);
  io.say(
    `reindex-connected-sources: done — ${counted(reindexed.value.length, "connected source")} wiped (${counted(passages, "passage")}) and queued to index again`,
  );
  return DONE;
};

export const objectStoreOrphans = async (
  doors: Doors,
  workspaceId: string,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const listing = flags.get("list");
  if (listing !== undefined && listing !== true) {
    io.say("object-store-orphans: --list takes no value");
    return USAGE;
  }
  const objects = doorTold(
    doors.objects,
    "no object store is configured (S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY on the api service), so the bytes a failed connect left cannot be reached",
  );
  if (!objects.ok) {
    io.say(`object-store-orphans: REFUSED — ${objects.error}`);
    return REFUSED;
  }
  const swept = await withSweepLock(SWEEPS, doors.postgres, () =>
    sweepOrphanedUploads(
      UPLOAD_SWEEP,
      { postgres: doors.postgres, objects: objects.value },
      { workspaceId, now: doors.clock.now(), dryRun: listing === true },
    ),
  );
  if (!swept.ok) return refused("object-store-orphans", workspaceId, swept.error, io);
  const past = `past the ${ORPHANED_UPLOAD_GRACE_HOURS}-hour grace no document names`;
  io.say(
    listing === true
      ? `object-store-orphans: done — ${counted(swept.value.found, "object")} ${past}, removed none`
      : `object-store-orphans: done — removed ${counted(swept.value.removed, "object")} ${past}`,
  );
  return DONE;
};
