import { declareRefusals, type RefusalWordFor } from "../kernel/index.ts";

export const WORKSPACE_REFUSALS = declareRefusals("workspaces", {
  "no-such-user": "absent",
  "no-such-workspace": "absent",

  // The row a live session stands on, gone under it: the remedy is a fresh sign-in, never a hunt
  // for something the reader never named.
  "workspace-gone": "unauthenticated",
  "person-gone": "unauthenticated",

  "slug-taken": "conflict",
  "workspace-exists": "conflict",
  "already-a-member": "conflict",
});

export type WorkspaceRefusal<W extends RefusalWordFor<typeof WORKSPACE_REFUSALS>> = W;
