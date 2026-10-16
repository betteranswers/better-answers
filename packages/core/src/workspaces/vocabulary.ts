import type { RefusalWordFor, Vocabulary } from "../kernel/index.ts";

export const WORKSPACE_REFUSALS = {
  "no-such-user": "absent",
  "no-such-workspace": "absent",

  "workspace-gone": "unauthenticated",
  "person-gone": "unauthenticated",
  "session-gone": "unauthenticated",

  "slug-taken": "conflict",
  "workspace-exists": "conflict",
  "already-a-member": "conflict",
  "person-exists": "conflict",

  "no-display-name": "precondition",

  "display-name-empty": "malformed",
  "display-name-not-one-line": "malformed",
  "display-name-control-character": "malformed",
  "display-name-angle-bracket": "malformed",
  "display-name-too-long": "malformed",

  "no-authenticator": "absent",
  "no-passkey": "absent",
  "recovery-code-wrong": "absent",
  "restore-code-wrong": "absent",
  "passkey-not-yours": "forbidden",

  "setup-not-granted": "precondition",

  "restore-code-needed": "precondition",

  "passkey-name-empty": "malformed",
  "passkey-name-too-long": "malformed",

  "recovery-codes-held": "conflict",

  "no-sub-processor": "precondition",
  "no-model-price": "precondition",
  // The index's vectors are the embedding model's: another could not read them.
  "fixed-model-choice": "inapplicable",

  "last-second-factor": "precondition",
} as const satisfies Vocabulary;

export type WorkspaceRefusal<W extends RefusalWordFor<typeof WORKSPACE_REFUSALS>> = W;
