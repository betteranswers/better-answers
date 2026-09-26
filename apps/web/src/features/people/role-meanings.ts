import type { Role } from "./people-api.ts";

/** Highest first, the order a role is offered in. */
export const ROLES: readonly Role[] = ["Admin", "Editor", "Viewer"];

export const roleOf = (word: string): Role | undefined => ROLES.find((role) => role === word);

export { aRole, ROLE_MEANINGS } from "@/shared/role-words.ts";
