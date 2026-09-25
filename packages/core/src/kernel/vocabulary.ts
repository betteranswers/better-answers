import { declareRefusals, type RefusalClass, type Vocabulary } from "./refusal.ts";

/**
 * A word naming a thing one slice owns stays there; a second slice borrows it rather than move it.
 */
export const KERNEL_REFUSALS = declareRefusals("kernel", {
  malformed: "malformed",
  "role-forbids": "forbidden",
  "not-found": "absent",

  // The resolver's five: the remedy is a fresh sign-in, which `role-forbids` never is.
  "not-a-member": "unauthenticated",
  "credentials-revoked": "unauthenticated",
  "role-disagrees": "unauthenticated",
  "role-unknown": "unauthenticated",
  "malformed-claims": "unauthenticated",

  // The envelope's three: both tiers answer a frame they cannot open in these words, the frame
  // being what they agree through.
  "envelope-version-unknown": "inapplicable",
  "envelope-malformed": "malformed",
  "envelope-not-authentic": "malformed",
});

type KernelRefusalWord = Extract<keyof typeof KERNEL_REFUSALS, string>;

export type KernelRefusal<W extends KernelRefusalWord> = W;

export type RefusalWordFor<V extends Vocabulary> = KernelRefusalWord | Extract<keyof V, string>;

/**
 * Read off the register rather than restated, so a word whose class moved cannot pass unnoticed.
 */
export type KernelRefusalOfClass<C extends RefusalClass> = {
  [W in KernelRefusalWord]: (typeof KERNEL_REFUSALS)[W] extends C ? W : never;
}[KernelRefusalWord];

export const NOT_FOUND = "not-found" satisfies KernelRefusalWord;

export const MALFORMED = "malformed" satisfies KernelRefusalWord;
