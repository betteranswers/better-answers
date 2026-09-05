/**
 * The client says *organization*; this platform says *workspace* (`CONTEXT.md`), and the
 * word a person reads is the platform's everywhere.
 *
 * The module's own plain word map, read directly by the screens that render its words
 * (T-046 slice 2) — no longer a library `localization` parameter. The keys keep the
 * client's nouns so a reader can trace a word to the call it faces; T-027 adds the
 * People screens' eight keys beside these four.
 *
 * `organizationsDescription` loses its verb as well as its noun: there is no
 * create-workspace control anywhere in this product — workspaces are
 * platform-provisioned (T-004 judgement call 1).
 */
export const WORKSPACE_WORDS = {
  organization: "Workspace",
  organizations: "Workspaces",
  noOrganizations: "No workspaces",
  organizationsDescription:
    "The workspaces you are a member of. An Admin adds you to one; you cannot create one yourself.",
} as const;
