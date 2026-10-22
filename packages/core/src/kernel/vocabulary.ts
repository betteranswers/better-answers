import type { RefusalClass, Vocabulary } from "./refusal.ts";

export const KERNEL_REFUSALS = {
  malformed: "malformed",
  "role-forbids": "forbidden",
  "owner-forbids": "forbidden",
  "not-found": "absent",

  "not-the-operator": "forbidden",

  "confirmation-too-old": "precondition",

  "second-factor-pending": "precondition",

  "changed-meanwhile": "conflict",

  "not-a-member": "unauthenticated",
  "credentials-revoked": "unauthenticated",
  "role-disagrees": "unauthenticated",
  "role-unknown": "unauthenticated",
  "malformed-claims": "unauthenticated",

  "envelope-version-unknown": "inapplicable",
  "envelope-malformed": "malformed",
  "envelope-not-authentic": "malformed",

  "spending-limit-met": "precondition",
} as const satisfies Vocabulary;

type KernelRefusalWord = Extract<keyof typeof KERNEL_REFUSALS, string>;

export type KernelRefusal<W extends KernelRefusalWord> = W;

export type RefusalWordFor<V extends Vocabulary> = KernelRefusalWord | Extract<keyof V, string>;

export type KernelRefusalOfClass<C extends RefusalClass> = {
  [W in KernelRefusalWord]: (typeof KERNEL_REFUSALS)[W] extends C ? W : never;
}[KernelRefusalWord];

export const NOT_FOUND = "not-found" satisfies KernelRefusalWord;

export const MALFORMED = "malformed" satisfies KernelRefusalWord;
