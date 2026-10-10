import type { UserPrincipal } from "./principal.ts";

export type AdminUserPrincipal = UserPrincipal & { readonly role: "Admin" };
