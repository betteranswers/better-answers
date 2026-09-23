import { boundarySchemas, FULL_REBUILD_KIND } from "@better-answers/schema";

import { act, declareActs, record } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  ulid,
  type PlatformPrincipal,
  type PrincipalRefusal,
  type Result,
} from "../kernel/index.ts";
import { enqueueJob, type EnqueueJobRefusal, type RebuildReason } from "../runs/index.ts";
import {
  countMap,
  sweepNonLiveGenerations,
  type GraphCounts,
  type SweptGeneration,
} from "../store/graph/index.ts";
import { withScope, type PostgresDoor } from "../store/postgres/index.ts";

const GRAPH_ACTOR = "process:better-answers-graph";

export type GraphMaintenancePrincipal = PlatformPrincipal & {
  readonly actorId: typeof GRAPH_ACTOR;
};

export const GRAPH_MAINTENANCE: GraphMaintenancePrincipal = {
  kind: "platform",
  actorId: GRAPH_ACTOR,
};

const GRAPH_ACTS = declareActs("platform", {
  swept: act("platform.graph.swept", {
    generation: "count",
    nodes: "count",
    edges: "count",
  }),
});

export type GraphMaintenanceRefusal = "malformed";

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

export const rebuildGraph = async (
  platform: GraphMaintenancePrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string; readonly reason: RebuildReason },
): Promise<
  Result<
    { readonly jobId: string },
    GraphMaintenanceRefusal | EnqueueJobRefusal | PrincipalRefusal | Error
  >
> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  return enqueueJob(platform, door, {
    workspaceId: workspace.data,
    kind: FULL_REBUILD_KIND,
    reason: input.reason,
  });
};
