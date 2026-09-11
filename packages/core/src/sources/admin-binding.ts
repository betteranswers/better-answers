import { boundarySchemas } from "@better-answers/schema";

import {
  err,
  ok,
  requireAdmin,
  type AdminUserPrincipal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";

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
 * It is written once because more than one act opens this way — the DPIA input (`dpia.ts`)
 * and the review list (`passages.ts`) — and the same decision taken in two places is a
 * decision that can come apart. The narrowing act (`index.ts`) opens the same way and decides
 * one more refusal beside these two; it is not folded in here, because that act's own suites
 * are what would have to prove the fold and they are not this ticket's.
 */

const BINDING_ID = boundarySchemas.sourceBinding.select.shape.id;

/** The Admin acting and the binding they named, once both refusals are past. */
type ActingOnBinding = {
  readonly admin: AdminUserPrincipal;
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
  return ok({ admin: admin.value, bindingId: named.data });
};
