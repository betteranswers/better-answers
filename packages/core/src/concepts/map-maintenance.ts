import { boundarySchemas, FULL_REBUILD_KIND } from "@better-answers/schema";

import { action, declareActions, recordEach } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  type PlatformPrincipal,
  type PrincipalRefusal,
  type Result,
} from "../kernel/index.ts";
import { enqueueJob, type EnqueueJobRefusal, type RebuildReason } from "../runs/index.ts";
import {
  countMap,
  sweepNonLiveGenerations,
  type MapCounts,
  type SweptGeneration,
} from "../store/map/index.ts";
import { withScope, type PostgresDoor } from "../store/postgres/index.ts";

const MAP_ACTOR = "process:better-answers-graph";

export type MapMaintenancePrincipal = PlatformPrincipal & {
  readonly actorId: typeof MAP_ACTOR;
};

export const MAP_MAINTENANCE: MapMaintenancePrincipal = {
  kind: "platform",
  actorId: MAP_ACTOR,
};

const MAP_ACTIONS = declareActions("platform", {
  swept: action("platform.graph.swept", {
    generation: "count",
    nodes: "count",
    edges: "count",
  }),
});

export type MapMaintenanceRefusal = "malformed";

export const mapCounts = async (
  platform: MapMaintenancePrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string },
): Promise<Result<MapCounts, MapMaintenanceRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const counted = await attempt(() =>
    withScope(platform, door, workspace.data, (tx) => countMap(platform, tx, workspace.data)),
  );
  return counted.ok ? ok(counted.value) : err(counted.error);
};

/**
 * Deletes every map generation but the live one, with an audit event for each, under one batch
 * id when there are several.
 */
export const sweepMap = async (
  platform: MapMaintenancePrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string },
): Promise<Result<readonly SweptGeneration[], MapMaintenanceRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const swept = await attempt(() =>
    withScope(platform, door, workspace.data, async (tx) => {
      const generations = await sweepNonLiveGenerations(platform, tx, workspace.data);
      await recordEach(
        platform,
        tx,
        MAP_ACTIONS.swept,
        generations.map(({ gen, nodes, edges }) => ({
          subjectId: String(gen),
          detail: { generation: gen, nodes, edges },
        })),
      );
      return generations;
    }),
  );
  return swept.ok ? ok(swept.value) : err(swept.error);
};

/** Queues a full rebuild for the worker and returns its job id; nothing is rebuilt here. */
export const rebuildMap = async (
  platform: MapMaintenancePrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string; readonly reason: RebuildReason },
): Promise<
  Result<
    { readonly jobId: string },
    MapMaintenanceRefusal | EnqueueJobRefusal | PrincipalRefusal | Error
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
