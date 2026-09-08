import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, record } from "../audit/index.ts";
import { attempt, err, ok, ulid, type PlatformPrincipal, type Result } from "../kernel/index.ts";
import {
  countMap,
  sweepNonLiveGenerations,
  type GraphCounts,
  type SweptGeneration,
} from "../store/graph/index.ts";
import { withScope, type PostgresDoor } from "../store/postgres/index.ts";

/**
 * The two acts the estate performs **over** the map rather than through it — the count the
 * restore drill diffs and the sweep of what a finished rebuild left behind (ADR 0022's
 * recovery order; `apps/api/src/ops/index.ts`).
 *
 * They live in the concepts slice because the graph tables are its (the table-ownership
 * map: the act that owns the transaction owns the invariants over these rows), and they
 * are here rather than in the graph door because the sweep writes a ledger row: `audit`
 * imports `store`, so no store module may import `audit` (ADR 0029 rule 3). The SQL is the
 * door's, as every other statement over these tables is; the transaction, the principal
 * and the ledger row are the slice's.
 */

/** The graph maintenance actor — the platform principal's one form (`CONTEXT.md`, *actor id*). */
const GRAPH_ACTOR = "process:better-answers-graph";

/**
 * The principal these acts run under, narrowed to its own actor the way the reconciler's
 * is: the type is what holds "under `process:better-answers-graph`" at compile time, so no
 * other platform act can sweep a workspace's map under its own name. There is no person
 * behind either act — the drill and the recovery order are the callers — so a user
 * principal cannot reach them at all (`[SEC2]`, `[AUDIT4]`).
 */
export type GraphMaintenancePrincipal = PlatformPrincipal & {
  readonly actorId: typeof GRAPH_ACTOR;
};

export const GRAPH_MAINTENANCE: GraphMaintenancePrincipal = {
  kind: "platform",
  actorId: GRAPH_ACTOR,
};

/**
 * The sweep's one act. Its subject is the **generation removed**, so a sweep of three
 * generations is three rows sharing one batch id rather than one row hiding three
 * (`[AUDIT1]`), and the ledger answers "what happened to generation 2" by subject like any
 * other record. The detail carries the generation again beside the counts, as the
 * reconciler's carries its commit sha beside its subject, so a row reads whole.
 *
 * The count has no act: a read writes no row (`[AUDIT8]`).
 */
const GRAPH_ACTS = declareActs("platform", {
  swept: act("platform.graph.swept", {
    generation: "count",
    nodes: "count",
    edges: "count",
  }),
});

/** Why either act refused as a whole: a workspace argument that is not a workspace id. */
export type GraphMaintenanceRefusal = "malformed";

/**
 * The map by the numbers, for one workspace — what `pnpm ops graph-counts` answers and the
 * drill diffs against production's stamped run. A workspace nobody has mapped counts zero
 * of everything, which is *done* and not a failure: the tables exist, the map is empty.
 */
export const graphCounts = async (
  platform: GraphMaintenancePrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string },
): Promise<Result<GraphCounts, GraphMaintenanceRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const counted = await attempt(() =>
    withScope(platform, door, workspace.data, (tx) => countMap(platform, tx, workspace.data)),
  );
  return counted.ok ? ok(counted.value) : err(counted.error);
};

/**
 * Every generation but the live one removed, in one transaction, with its ledger rows
 * written in that same transaction — so a sweep whose events cannot be written removes
 * nothing (`[AUDIT1]`). A workspace with nothing to sweep is *done* with an empty list and
 * writes no row; so is a workspace whose generation row is absent, because a sweep that
 * could not say which generation is live would be a sweep of the map.
 */
export const sweepGraph = async (
  platform: GraphMaintenancePrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string },
): Promise<Result<readonly SweptGeneration[], GraphMaintenanceRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const swept = await attempt(() =>
    withScope(platform, door, workspace.data, async (tx) => {
      const generations = await sweepNonLiveGenerations(platform, tx, workspace.data);
      const batchId = generations.length > 1 ? ulid() : undefined;
      for (const generation of generations) {
        // The door is called bare (ADR 0014 rule 4): its rejection aborts this transaction.
        await record(platform, tx, {
          id: ulid(),
          act: GRAPH_ACTS.swept,
          subjectId: String(generation.gen),
          batchId,
          detail: {
            generation: generation.gen,
            nodes: generation.nodes,
            edges: generation.edges,
          },
        });
      }
      return generations;
    }),
  );
  return swept.ok ? ok(swept.value) : err(swept.error);
};
