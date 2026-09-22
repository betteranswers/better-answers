import { declareRefusals, type RefusalWordFor } from "../kernel/index.ts";

export const WORKSPACE_REFUSALS = declareRefusals("workspaces", {
  "no-such-user": "absent",
  "no-such-workspace": "absent",

  "slug-taken": "conflict",
  "workspace-exists": "conflict",
  "already-a-member": "conflict",
});

export type WorkspaceRefusal<W extends RefusalWordFor<typeof WORKSPACE_REFUSALS>> = W;
