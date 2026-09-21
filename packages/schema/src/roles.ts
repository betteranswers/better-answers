export const ROLES = ["Admin", "Editor", "Viewer"] as const;

export const CREATOR_ROLE = "Admin" satisfies (typeof ROLES)[number];
