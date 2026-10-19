import type { RefusalWordFor, Vocabulary } from "../kernel/index.ts";

export const MEMBER_REFUSALS = {
  "no-such-group": "absent",
  "no-such-member": "absent",
  "not-in-group": "absent",
  "no-such-request": "absent",
  "no-such-role": "absent",
  "no-such-invitation": "absent",

  "name-taken": "conflict",
  "already-in-group": "conflict",
  "already-decided": "conflict",

  "last-admin": "precondition",
  "invitation-expired": "precondition",

  "invitation-for-another-address": "forbidden",

  "off-testing-domain": "inapplicable",
} as const satisfies Vocabulary;

export type MemberRefusal<W extends RefusalWordFor<typeof MEMBER_REFUSALS>> = W;
