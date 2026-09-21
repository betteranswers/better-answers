import { boundarySchemas } from "@better-answers/schema";

import {
  attempt,
  err,
  ok,
  requireAdmin,
  type AdminUserPrincipal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx, TxRow } from "../store/postgres/index.ts";

const BINDING_ID = boundarySchemas.sourceBinding.select.shape.id;

export type ActingOnBinding = {
  readonly admin: AdminUserPrincipal;
  readonly workspaceId: string;
  readonly bindingId: string;
};

export const adminOnBinding = (
  principal: UserPrincipal,
  bindingId: string,
): Result<ActingOnBinding, RoleRefusal | "malformed"> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const named = BINDING_ID.safeParse(bindingId);
  if (!named.success) return err("malformed");
  return ok({ admin: admin.value, workspaceId: admin.value.workspaceId, bindingId: named.data });
};

type BindingRead = {
  readonly columns: string;

  readonly lock: "for-update" | "none";
};

export const bindingNamed = async <Row extends TxRow>(
  acting: ActingOnBinding,
  tx: Tx,
  read: BindingRead,
): Promise<Result<Row, "no-such-binding" | Error>> => {
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
