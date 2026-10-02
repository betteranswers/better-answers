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
  "person-exists": "conflict",

  // A person is credited by name wherever they act, so nobody is let in without one.
  "no-display-name": "precondition",

  "display-name-empty": "malformed",
  "display-name-not-one-line": "malformed",
  "display-name-control-character": "malformed",
  "display-name-angle-bracket": "malformed",
  "display-name-too-long": "malformed",

  "no-authenticator": "absent",
  "no-passkey": "absent",
  "recovery-code-wrong": "absent",

  "passkey-name-empty": "malformed",
  "passkey-name-too-long": "malformed",

  // Asked for a first set while one stands: a page read before it was made would void it unasked.
  "recovery-codes-held": "conflict",

  // An Admin, or the operator, may hold no fewer than one: removing it waits on adding another.
  "last-second-factor": "precondition",
});

export type WorkspaceRefusal<W extends RefusalWordFor<typeof WORKSPACE_REFUSALS>> = W;
