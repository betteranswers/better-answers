import { boundarySchemas } from "@better-answers/schema";

import { attempt, err, ok, type PlatformPrincipal, type Result } from "../kernel/index.ts";
import { WIPE_REASON } from "../runs/index.ts";
import { withScope, type PostgresDoor } from "../store/postgres/index.ts";
import { CONNECTED_SOURCE_ID } from "./admin-connected-source.ts";
import {
  reprocessConnectedSource,
  type ConnectedSourceReprocessed,
  type ReprocessConnectedSourceRefusal,
} from "./connected-source.ts";

const REINDEX_ACTOR = "process:better-answers-reindex";

type ReindexPrincipal = PlatformPrincipal & {
  readonly actorId: typeof REINDEX_ACTOR;
};

export const REINDEX: ReindexPrincipal = {
  kind: "platform",
  actorId: REINDEX_ACTOR,
};

const CONNECTED_SOURCES = `SELECT id FROM connected_source WHERE workspace_id = $1 ORDER BY id`;

type ReindexRefusal = "malformed" | ReprocessConnectedSourceRefusal;

/**
 * Runs every connected source in the workspace through the `wiped` reason, as a release that
 * renames the engine's target needs. A transaction per source, so a rerun repeats the rest harmlessly.
 */
export const reindexEveryConnectedSource = async (
  platform: ReindexPrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string },
): Promise<Result<readonly ConnectedSourceReprocessed[], ReindexRefusal>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const workspaceId = workspace.data;

  const listed = await attempt(() =>
    withScope(platform, door, workspaceId, (tx) =>
      tx.query<{ id: string }>(CONNECTED_SOURCES, [workspaceId]),
    ),
  );
  if (!listed.ok) return err(listed.error);

  const reindexed: ConnectedSourceReprocessed[] = [];
  for (const { id } of listed.value.rows) {
    const connectedSourceId = CONNECTED_SOURCE_ID.parse(id);
    const wiped = await withScope(platform, door, workspaceId, (tx) =>
      reprocessConnectedSource(platform, tx, {
        workspaceId,
        connectedSourceId,
        reason: WIPE_REASON,
      }),
    );
    if (!wiped.ok) return err(wiped.error);
    reindexed.push(wiped.value);
  }
  return ok(reindexed);
};
