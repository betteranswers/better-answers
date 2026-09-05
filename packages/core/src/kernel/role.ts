import type { UserPrincipal } from "./principal.ts";
import { err, ok, type Result } from "./result.ts";

/**
 * The one word for *this role may not do this* — the refusal every role-guarded act
 * answers with, so a caller has one case to handle however many verbs it reaches.
 *
 * It is not in `PrincipalRefusal`: those five are the resolver's, decided before a
 * Principal exists, and a transport maps every one of them to *sign in again*. This
 * one is decided after a Principal exists and means *you, as you are, may not* — a
 * screen keeps the person where they are and hides the control. Hyphenated in the same
 * family as its neighbours (*not-a-member*, *credentials-revoked*), naming what refused
 * rather than what the caller lacks.
 */
export type RoleRefusal = "role-forbids";

/**
 * A Principal at the highest role a workspace has (`CONTEXT.md`, *role (of a person)*:
 * Admin, Editor, Viewer — a level, never a job title). An act that requires one takes
 * this type, so the check is in the signature rather than repeated in the body.
 */
export type AdminPrincipal = UserPrincipal & { readonly role: "Admin" };

/**
 * The guard: an Admin comes back narrowed and every other role comes back as the one
 * refusal word. Pure, so a verb can be guarded before it opens a transaction.
 */
export const requireAdmin = (principal: UserPrincipal): Result<AdminPrincipal, RoleRefusal> => {
  const { role } = principal;
  return role === "Admin" ? ok({ ...principal, role }) : err("role-forbids");
};
