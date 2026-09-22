import type { UserPrincipal } from "./principal.ts";
import type { KernelRefusal } from "./vocabulary.ts";
import { err, ok, type Result } from "./result.ts";

export type RoleRefusal = KernelRefusal<"role-forbids">;

export type AdminUserPrincipal = UserPrincipal & { readonly role: "Admin" };

export const requireAdmin = (principal: UserPrincipal): Result<AdminUserPrincipal, RoleRefusal> => {
  const { role } = principal;
  return role === "Admin" ? ok({ ...principal, role }) : err("role-forbids");
};
