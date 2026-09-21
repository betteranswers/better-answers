import { createAccessControl } from "better-auth/plugins/access";

import { CREATOR_ROLE, type ROLES } from "@better-answers/schema";

const statement = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
} as const;

export const accessControl = createAccessControl(statement);

const Admin = accessControl.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
});

const Editor = accessControl.newRole({});
const Viewer = accessControl.newRole({});

type OrganisationRole = ReturnType<typeof accessControl.newRole>;

export const roles = { Admin, Editor, Viewer } satisfies Record<
  (typeof ROLES)[number],
  OrganisationRole
>;

export const creatorRole = CREATOR_ROLE;
