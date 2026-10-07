import { FULL_REBUILD_KIND } from "@better-answers/schema";

import { normalizeError, type PlatformPrincipal, type WorkspaceId } from "../kernel/index.ts";
import { enqueueJob, WIPE_REASON, type RebuildReason } from "../runs/index.ts";
import {
  CONNECTED_SOURCE_ID,
  reprocessConnectedSource,
  type ConnectedSourceId,
} from "../sources/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import type { ErasureFamily, ErasureMap } from "./map.ts";

const ERASURE_REASON: RebuildReason = "erasure";

const SOURCE_DOCUMENT: ErasureFamily = "source-document";

const documentsTheMapFound = (map: ErasureMap): readonly string[] => [
  ...new Set(map.find((entry) => entry.family === SOURCE_DOCUMENT)?.locations ?? []),
];

export type Rederived = {
  readonly rebuildJobId: string | null;

  readonly connectedSourcesToReprocess: readonly string[];
};

const connectedSourcesHolding = async (
  tx: Tx,
  workspaceId: string,
  documents: readonly string[],
): Promise<readonly ConnectedSourceId[]> => {
  if (documents.length === 0) return [];
  const found = await tx.query<{ connected_source_id: string }>(
    `SELECT DISTINCT connected_source_id FROM source_document
      WHERE workspace_id = $1 AND id = ANY($2::text[])
      ORDER BY connected_source_id`,
    [workspaceId, [...documents]],
  );
  return found.rows.map((row) => CONNECTED_SOURCE_ID.parse(row.connected_source_id));
};

/**
 * A transaction per connected source: a refusal takes back that connected source's wipe alone, and a rerun repeats
 * the rest harmlessly.
 */
const wipe = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  connectedSourceId: ConnectedSourceId,
): Promise<void> => {
  const wiped = await withScope(platform, door, workspaceId, (tx) =>
    reprocessConnectedSource(platform, tx, { workspaceId, connectedSourceId, reason: WIPE_REASON }),
  );
  if (!wiped.ok) throw normalizeError(wiped.error);
};

/**
 * Queues the full rebuild only for a request not yet completed; `rebuildJobId` is null otherwise.
 * Throws when a connected source's wipe or the rebuild is refused.
 */
export const rederiveAfterErasure = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly map: ErasureMap;
    readonly completedAt: Date | null;
  },
): Promise<Rederived> => {
  const connectedSourcesToReprocess = await withScope(platform, door, input.workspaceId, (tx) =>
    connectedSourcesHolding(tx, input.workspaceId, documentsTheMapFound(input.map)),
  );

  // A replay wipes too, since a restore from an older dump brings the passage rows back.
  for (const connectedSourceId of connectedSourcesToReprocess) {
    await wipe(platform, door, input.workspaceId, connectedSourceId);
  }

  if (input.completedAt !== null) return { rebuildJobId: null, connectedSourcesToReprocess };

  const queued = await enqueueJob(platform, door, {
    workspaceId: input.workspaceId,
    kind: FULL_REBUILD_KIND,
    reason: ERASURE_REASON,
  });

  if (!queued.ok) throw normalizeError(queued.error);
  return { rebuildJobId: queued.value.jobId, connectedSourcesToReprocess };
};
