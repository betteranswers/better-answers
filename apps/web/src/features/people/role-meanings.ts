import type { Role } from "./people-api.ts";

/** Highest first, the order a role is offered in. */
export const ROLES: readonly Role[] = ["Admin", "Editor", "Viewer"];

export const ROLE_MEANINGS = {
  Admin: "Manages people and sources, and does everything an Editor does.",
  Editor: "Checks concepts, runs question sets and saves Answers.",
  Viewer: "Asks questions, flags answers and suggests changes.",
} as const satisfies Readonly<Record<Role, string>>;

export const roleOf = (word: string): Role | undefined => ROLES.find((role) => role === word);

export { aRole } from "@/shared/role-words.ts";
