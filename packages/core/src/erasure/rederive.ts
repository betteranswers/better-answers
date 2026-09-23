import { FULL_REBUILD_KIND } from "@better-answers/schema";

import { normalizeError, type PlatformPrincipal, type WorkspaceId } from "../kernel/index.ts";
import { enqueueJob, WIPE_REASON, type RebuildReason } from "../runs/index.ts";
import { BINDING_ID, reprocessBinding, type BindingId } from "../sources/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import type { ErasureMap } from "./map.ts";
import { documentsTheMapFound } from "./suppressions.ts";

const ERASURE_REASON: RebuildReason = "erasure";

export type Rederived = {
  readonly rebuildJobId: string | null;

  readonly bindingsToReprocess: readonly string[];
};

const bindingsHolding = async (
  tx: Tx,
  workspaceId: string,
  documents: readonly string[],
): Promise<readonly BindingId[]> => {
  if (documents.length === 0) return [];
  const found = await tx.query<{ binding_id: string }>(
    `SELECT DISTINCT binding_id FROM source_document
      WHERE workspace_id = $1 AND id = ANY($2::text[])
      ORDER BY binding_id`,
    [workspaceId, [...documents]],
  );
  return found.rows.map((row) => BINDING_ID.parse(row.binding_id));
};

// A transaction per binding: a refusal takes back that binding's wipe alone, and a rerun repeats the rest harmlessly.
const wipe = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  bindingId: BindingId,
): Promise<void> => {
  const wiped = await withScope(platform, door, workspaceId, (tx) =>
    reprocessBinding(platform, tx, { workspaceId, bindingId, reason: WIPE_REASON }),
  );
  if (!wiped.ok) throw normalizeError(wiped.error);
};

export const rederiveAfterErasure = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly map: ErasureMap;
    readonly completedAt: Date | null;
  },
): Promise<Rederived> => {
  const bindingsToReprocess = await withScope(platform, door, input.workspaceId, (tx) =>
    bindingsHolding(tx, input.workspaceId, documentsTheMapFound(input.map)),
  );

  // A replay wipes too, since a restore from an older dump brings the chunk rows back.
  for (const bindingId of bindingsToReprocess) {
    await wipe(platform, door, input.workspaceId, bindingId);
  }

  if (input.completedAt !== null) return { rebuildJobId: null, bindingsToReprocess };

  const queued = await enqueueJob(platform, door, {
    workspaceId: input.workspaceId,
    kind: FULL_REBUILD_KIND,
    reason: ERASURE_REASON,
  });

  if (!queued.ok) throw normalizeError(queued.error);
  return { rebuildJobId: queued.value.jobId, bindingsToReprocess };
};
