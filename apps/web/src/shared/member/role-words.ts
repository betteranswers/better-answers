import type { Role } from "@/shared/navigation.ts";

export const aRole = (role: string): string => `${role === "Viewer" ? "a" : "an"} ${role}`;

export const ROLE_MEANINGS = {
  Admin: "Manages people and sources, and does everything an Editor does.",
  Editor: "Checks concepts, asks question sets and saves Answers.",
  Viewer: "Asks questions, flags answers and suggests changes.",
} as const satisfies Readonly<Record<Role, string>>;

export const ROLE_FOR_A_NEWCOMER = {
  Admin:
    "You can ask questions, check what the workspace knows, and save good answers. You also choose who joins and which sources it draws on.",
  Editor:
    "You can ask questions, check what the workspace knows, and save good answers for others to reuse.",
  Viewer: "You can ask questions, flag an answer that looks wrong, and suggest a change.",
} as const satisfies Readonly<Record<Role, string>>;
