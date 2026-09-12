import { FULL_REBUILD_KIND } from "@better-answers/schema";

import { normalizeError, type PlatformPrincipal } from "../kernel/index.ts";
import { enqueueJob, type RebuildReason } from "../runs/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import type { ErasureMap } from "./map.ts";
import { documentsTheMapFound } from "./suppressions.ts";

/**
 * Step 7 of the erasure routine (ADR 0020; ADR 0023; ADR 0036 as amended 2026-09-10; the S0
 * spec, *The routine*, step 7): the derived stores made again from the sources that remain.
 *
 * Two halves. The **graph** is re-derived by a `full-rebuild` job with reason *erasure* — one
 * of ADR 0023's six, already on the list, so this step adds no reason and no kind. The
 * **per-binding wipe** is the other: for every binding holding a document the map found, the
 * binding's chunk rows go and an `index` job with reason *wiped* is enqueued inside the same
 * transaction, the worker removing the binding's directory before it opens the Environment on
 * that job because the directory sits on the worker's volume and the app cannot reach it.
 *
 * **The wipe is present and finds none, and the shape it leaves for S1 is the list below.**
 * `reprocessBinding` is S1's act and does not exist yet, so this step stops at the list of
 * bindings it would be run over, in order. The list is **not** vacuous by construction: a
 * binding is found by the documents the map named, and that read works today — seed documents,
 * hand the step a map that names them, and it answers their bindings. What is empty today is
 * the map's document family, whose finder S1 writes. So S1 lands one loop over
 * `bindingsToReprocess` inside a scoped transaction and changes nothing else here.
 */

/** ADR 0023's reason for this rebuild, typed against the six so a struck one fails to compile. */
const ERASURE_REASON: RebuildReason = "erasure";

/** What step 7 did, and what it left for the act S1 lands. */
export type Rederived = {
  /** The job that re-derives the graph, so a caller can wait for the map to be made again. */
  readonly rebuildJobId: string | null;
  /**
   * The bindings whose derived copies this erasure invalidates, in a stable order. Empty
   * today, and empty because the map named no document — never because nobody looked.
   */
  readonly bindingsToReprocess: readonly string[];
};

/**
 * The bindings holding the documents the map found.
 *
 * A suppression is per document and a wipe is per binding, because a binding is what a
 * conversion runs over: one document of it naming the person is the whole binding's derived
 * copies out of date, and the suppressions are what keep the person out when it is converted
 * again. So the two halves read the same list of documents and part here.
 */
const bindingsHolding = async (
  tx: Tx,
  workspaceId: string,
  documents: readonly string[],
): Promise<readonly string[]> => {
  if (documents.length === 0) return [];
  const found = await tx.query<{ binding_id: string }>(
    `SELECT DISTINCT binding_id FROM source_document
      WHERE workspace_id = $1 AND id = ANY($2::text[])
      ORDER BY binding_id`,
    [workspaceId, [...documents]],
  );
  return found.rows.map((row) => row.binding_id);
};

/**
 * Run step 7 for one erasure.
 *
 * **The rebuild is enqueued for the run that completes the request and for no other.**
 * `completedAt` is the completion standing on the row when the routine opened it under the
 * lock — the first run's, and the one step 11 will refuse to move — so a replay re-runs every
 * step and leaves the queue as it found it (the spec's *Idempotent by construction*: a second
 * run writes a ledger event and nothing else). The queue has no key to conflict on in S0, so
 * this is the sentence that does the work a conflict does everywhere else in the routine; S1's
 * run key on `job` is what will make it a conflict instead.
 *
 * It goes through the `runs` slice's own face rather than an INSERT of its own, because `job`
 * is that slice's table and the pairing of a kind with a reason is its rule to apply.
 */
export const rederiveAfterErasure = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: {
    readonly workspaceId: string;
    readonly map: ErasureMap;
    readonly completedAt: Date | null;
  },
): Promise<Rederived> => {
  const bindingsToReprocess = await withScope(platform, door, input.workspaceId, (tx) =>
    bindingsHolding(tx, input.workspaceId, documentsTheMapFound(input.map)),
  );
  // S1's `reprocessBinding` is run over `bindingsToReprocess` here, one act in order, each
  // deleting the binding's chunk rows and enqueueing its `index` job in one transaction.
  if (input.completedAt !== null) return { rebuildJobId: null, bindingsToReprocess };

  const queued = await enqueueJob(platform, door, {
    workspaceId: input.workspaceId,
    kind: FULL_REBUILD_KIND,
    reason: ERASURE_REASON,
  });
  // An erasure whose re-derivation could not be queued is an erasure that left the derived map
  // naming the person: thrown, so the routine's own `attempt` turns it into the refusal a
  // caller hears rather than a completion that quietly skipped a step.
  if (!queued.ok) throw normalizeError(queued.error);
  return { rebuildJobId: queued.value.jobId, bindingsToReprocess };
};
