import { createAccessControl } from "better-auth/plugins/access";

import { CREATOR_ROLE, type ROLES } from "@better-answers/schema";

const statement = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
} as const;

export const accessControl = createAccessControl(statement);

/** Every write these statements name is a disabled path, so a grant would only make has-permission lie. */
const Admin = accessControl.newRole({});
const Editor = accessControl.newRole({});
const Viewer = accessControl.newRole({});

type OrganisationRole = ReturnType<typeof accessControl.newRole>;

export const roles = { Admin, Editor, Viewer } satisfies Record<
  (typeof ROLES)[number],
  OrganisationRole
>;

export const creatorRole = CREATOR_ROLE;
