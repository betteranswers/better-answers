/**
 * The library says *organization*; this platform says *workspace* (`CONTEXT.md`), and the
 * word a person reads is the platform's everywhere.
 *
 * better-auth-ui's organisation strings are a per-plugin `localization`, spread shallowly
 * over its defaults, so naming four keys keeps the rest. These four are the ones a screen
 * in this ticket renders; the rest of the set belongs to acts this platform does not have
 * — create, delete, leave, invite, teams, roles — and is left alone until the screen that
 * needs it exists (T-027). The full table is in
 * `docs/research/t-022-better-auth-ui.md` § 2.
 *
 * `organizationsDescription` loses its verb as well as its noun: upstream reads "Create an
 * organization to collaborate with others", and there is no create-workspace control
 * anywhere in this product — workspaces are platform-provisioned (T-004 judgement call 1).
 */
export const WORKSPACE_WORDS = {
  organization: "Workspace",
  organizations: "Workspaces",
  noOrganizations: "No workspaces",
  organizationsDescription:
    "The workspaces you are a member of. An Admin adds you to one; you cannot create one yourself.",
} as const;
