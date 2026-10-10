import type { UserPrincipal } from "./principal.ts";
import type { KernelRefusal } from "./vocabulary.ts";

export type RoleRefusal = KernelRefusal<"role-forbids">;

export type AdminUserPrincipal = UserPrincipal & { readonly role: "Admin" };
