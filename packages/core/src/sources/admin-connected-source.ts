import { boundarySchemas, type ConnectedSourceId } from "@better-answers/schema";

import {
  attempt,
  err,
  ok,
  type AdminUserPrincipal,
  type PlatformPrincipal,
  type Result,
  type WorkspaceId,
} from "../kernel/index.ts";
import type { Tx, TxRow } from "../store/postgres/index.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export const CONNECTED_SOURCE_ID = boundarySchemas.connectedSource.select.shape.id;

export type { ConnectedSourceId };

export const CONNECTED_SOURCE_VISIBILITY = boundarySchemas.connectedSource.select.pick({
  sensitivity: true,
  audience: true,
  audienceGroups: true,
});

export type ActingOnConnectedSource = {
  readonly admin: AdminUserPrincipal;
  readonly workspaceId: WorkspaceId;
  readonly connectedSourceId: ConnectedSourceId;
};

/** The platform carries no workspace, so its standing names the one its action was asked for. */
export type PlatformOnConnectedSource = {
  readonly platform: PlatformPrincipal;
  readonly workspaceId: WorkspaceId;
  readonly connectedSourceId: ConnectedSourceId;
};

export const adminOnConnectedSource = (
  admin: AdminUserPrincipal,
  connectedSourceId: ConnectedSourceId,
): ActingOnConnectedSource => ({ admin, workspaceId: admin.workspaceId, connectedSourceId });

type ConnectedSourceRead = {
  readonly columns: string;

  readonly lock: "for-update" | "none";
};

type ConnectedSourceNamedRefusal = SourceRefusal<"no-such-binding"> | Error;

/**
 * `columns` is spliced into the SQL unescaped, so it takes a literal list, never input.
 * `for-update` holds the row until the transaction ends.
 */
export const connectedSourceNamed = async <Row extends TxRow>(
  acting: ActingOnConnectedSource | PlatformOnConnectedSource,
  tx: Tx,
  read: ConnectedSourceRead,
): Promise<Result<Row, ConnectedSourceNamedRefusal>> => {
  const locked = read.lock === "for-update" ? " FOR UPDATE" : "";
  const found = await attempt(() =>
    tx.query<Row>(
      `SELECT ${read.columns} FROM connected_source WHERE workspace_id = $1 AND id = $2${locked}`,
      [acting.workspaceId, acting.connectedSourceId],
    ),
  );
  if (!found.ok) return err(found.error);
  const connectedSource = found.value.rows[0];
  if (connectedSource === undefined) return err("no-such-binding");
  return ok(connectedSource);
};
