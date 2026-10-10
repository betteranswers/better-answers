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

  // Someone else is made an Admin first.
  "last-admin": "precondition",
  // An Admin sends the invitation again, or a new one.
  "invitation-expired": "precondition",

  // Only the person signed in with the invited address may take it up.
  "invitation-for-another-address": "forbidden",

  // A marked workspace invites its testing domain alone, and nothing an Admin does lifts that.
  "off-testing-domain": "inapplicable",
  // A test person is never the operator nor a member anywhere else: the remedy is another address.
  "operator-marked": "inapplicable",
  "member-elsewhere": "inapplicable",
} as const satisfies Vocabulary;

export type MemberRefusal<W extends RefusalWordFor<typeof MEMBER_REFUSALS>> = W;
