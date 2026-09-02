/**
 * The three roles of a person (CONTEXT.md, *role (of a person)*): a level, never a job
 * title. The one place the words live (`[GLOSSARY1]`, `[DEPS2]`): the `member.role`
 * boundary narrows to this set, the organisation plugin registers exactly these three,
 * and `packages/core`'s `Role` type is inferred from the boundary.
 */
export const ROLES = ["Admin", "Editor", "Viewer"] as const;

/** The role a workspace's first member — its creator — holds. */
export const CREATOR_ROLE = "Admin" satisfies (typeof ROLES)[number];
