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

/**
 * The head of an Admin's act on a binding it is handed the id of: the two refusals every one
 * of them decides before it reads a row, in the order it decides them.
 *
 * The role first, so a person who may not act learns nothing from the id they asked with —
 * not whether a binding of that shape could exist, not whether this workspace holds one. Then
 * the shape, against the binding table's own id column schema, so no act carries a caller's
 * string as far as a statement. Past both there is an Admin and a binding id, and the act can
 * begin.
 *
 * It is written once because more than one act opens this way — the DPIA input (`dpia.ts`),
 * the review list (`passages.ts`), and the publish and the reprocess (`binding.ts`) — and the
 * same decision taken in two places is a decision that can come apart. The narrowing act
 * (`index.ts`) opens the same way and decides one more refusal beside these two; it is not
 * folded in here, because that act's own suites are what would have to prove the fold and they
 * are not this ticket's.
 */

const BINDING_ID = boundarySchemas.sourceBinding.select.shape.id;

/** The Admin acting, the workspace they act in, and the binding they named. */
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

/** How an act wants the binding read: the columns it needs, and whether it means to write. */
type BindingRead = {
  /**
   * The columns off the row this act needs, as it would write them after `SELECT` — its own
   * literal and never a string a caller handed in. An act that needs no column and only
   * whether the row is there asks for `1`.
   */
  readonly columns: string;
  /**
   * `for-update` for an act that goes on to write the binding or the rows derived from it, so
   * two of them queue rather than both reading the row and both acting on what they read.
   * `none` for a read, which has nothing to serialise against.
   */
  readonly lock: "for-update" | "none";
};

/**
 * The head continued to the binding itself: the row this workspace holds at that id, or
 * `no-such-binding`.
 *
 * The columns and the lock are each act's own, because what they need off the row and whether
 * they mean to write differ — the publish takes the published instant under a lock, the
 * reprocess takes no column and only the lock, the DPIA input takes three columns and no lock.
 * What none of them may decide differently is written here: that a binding is found by its
 * workspace **and** its id and never by the id alone, which is the isolation the whole slice
 * rests on, and that a workspace holding no row at that id is `no-such-binding` rather than an
 * empty answer a caller has to interpret.
 *
 * It takes the head's own answer rather than the Principal, so an act that must decide
 * something between the two — the publish, which refuses a missing confirmation before it asks
 * the database anything — keeps that refusal in its own order.
 */
export const bindingNamed = async <Row extends TxRow>(
  tx: Tx,
  acting: ActingOnBinding,
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
