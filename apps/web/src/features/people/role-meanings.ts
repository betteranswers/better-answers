import type { Role } from "./people-api.ts";

export const ROLES: readonly Role[] = ["Admin", "Editor", "Viewer"];

export const roleOf = (word: string): Role | undefined => ROLES.find((role) => role === word);

export { aRole, ROLE_MEANINGS } from "@/shared/member/role-words.ts";
