import { createAccessControl } from "better-auth/plugins/access";

import { CREATOR_ROLE, type ROLES } from "@better-answers/schema";

/**
 * The three roles through the organisation plugin's access control (grilling rounds
 * 2–3, 2026-09-01): Admin, Editor, Viewer, with Admin as the creator role, and Better
 * Auth's owner/admin/member defaults not registered, so the glossary's three words are
 * the only roles the database or the plugin can name. The statements
 * are Better Auth's organisation resources — what the plugin's own endpoints consult
 * when a member invites, removes or updates another. The platform's own action
 * thresholds are the slices'; this is only what Better Auth needs.
 */
const statement = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
} as const;

export const accessControl = createAccessControl(statement);

/** Admin: everything but deleting the workspace, which is the platform's act. */
const Admin = accessControl.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
});

/** Editor and Viewer: no organisation-level act; their difference is the slices'. */
const Editor = accessControl.newRole({});
const Viewer = accessControl.newRole({});

type OrganisationRole = ReturnType<typeof accessControl.newRole>;

export const roles = { Admin, Editor, Viewer } satisfies Record<
  (typeof ROLES)[number],
  OrganisationRole
>;

export const creatorRole = CREATOR_ROLE;
