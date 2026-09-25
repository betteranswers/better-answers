import { declareRefusals, type RefusalWordFor } from "../kernel/index.ts";

export const MEMBER_REFUSALS = declareRefusals("members", {
  "no-such-group": "absent",
  "no-such-member": "absent",
  "not-in-group": "absent",
  "no-such-request": "absent",
  "no-such-role": "absent",

  "name-taken": "conflict",
  "already-in-group": "conflict",
  "already-decided": "conflict",
});

export type MemberRefusal<W extends RefusalWordFor<typeof MEMBER_REFUSALS>> = W;
