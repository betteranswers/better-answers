import { declareRefusals, type Vocabulary } from "./refusal.ts";

// A word naming a thing one slice owns stays there; a second slice borrows it rather than move it.
const KERNEL_REFUSALS = declareRefusals("kernel", {
  malformed: "malformed",
  "role-forbids": "forbidden",
  "not-found": "absent",

  // The resolver's five: the remedy is a fresh sign-in, which `role-forbids` never is.
  "not-a-member": "unauthenticated",
  "credentials-revoked": "unauthenticated",
  "role-disagrees": "unauthenticated",
  "role-unknown": "unauthenticated",
  "malformed-claims": "unauthenticated",
});

type KernelRefusalWord = Extract<keyof typeof KERNEL_REFUSALS, string>;

export type KernelRefusal<W extends KernelRefusalWord> = W;

export type RefusalWordFor<V extends Vocabulary> = KernelRefusalWord | Extract<keyof V, string>;

export const NOT_FOUND = "not-found" satisfies KernelRefusalWord;
