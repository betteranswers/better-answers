import { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

import {
  attempt,
  err,
  ok,
  requireAdmin,
  type AdminUserPrincipal,
  type PlatformPrincipal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
  type WorkspaceId,
} from "../kernel/index.ts";
import type { Tx, TxRow } from "../store/postgres/index.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export const BINDING_ID = boundarySchemas.sourceBinding.select.shape.id;

export type BindingId = z.output<typeof BINDING_ID>;

export const BINDING_VISIBILITY = boundarySchemas.sourceBinding.select.pick({
  sensitivity: true,
  audience: true,
  audienceGroups: true,
});

export type ActingOnBinding = {
  readonly admin: AdminUserPrincipal;
  readonly workspaceId: WorkspaceId;
  readonly bindingId: BindingId;
};

/** The platform carries no workspace, so its standing names the one its act was asked for. */
export type PlatformOnBinding = {
  readonly platform: PlatformPrincipal;
  readonly workspaceId: WorkspaceId;
  readonly bindingId: BindingId;
};

export const adminOnBinding = (
  principal: UserPrincipal,
  bindingId: BindingId,
): Result<ActingOnBinding, RoleRefusal> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  return ok({ admin: admin.value, workspaceId: admin.value.workspaceId, bindingId });
};

type BindingRead = {
  readonly columns: string;

  readonly lock: "for-update" | "none";
};

type BindingNamedRefusal = SourceRefusal<"no-such-binding"> | Error;

/**
 * `columns` is spliced into the SQL unescaped, so it takes a literal list, never input.
 * `for-update` holds the row until the transaction ends.
 */
export const bindingNamed = async <Row extends TxRow>(
  acting: ActingOnBinding | PlatformOnBinding,
  tx: Tx,
  read: BindingRead,
): Promise<Result<Row, BindingNamedRefusal>> => {
  const locked = read.lock === "for-update" ? " FOR UPDATE" : "";
  const found = await attempt(() =>
    tx.query<Row>(
      `SELECT ${read.columns} FROM source_binding WHERE workspace_id = $1 AND id = $2${locked}`,
      [acting.workspaceId, acting.bindingId],
    ),
  );
  if (!found.ok) return err(found.error);
  const binding = found.value.rows[0];
  if (binding === undefined) return err("no-such-binding");
  return ok(binding);
};
