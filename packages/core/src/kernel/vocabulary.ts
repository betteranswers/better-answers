import type { RefusalClass, Vocabulary } from "./refusal.ts";

/**
 * A word naming a thing one slice owns stays there; a second slice borrows it rather than move it.
 */
export const KERNEL_REFUSALS = {
  malformed: "malformed",
  "role-forbids": "forbidden",
  "not-found": "absent",

  // The operator resolver's one word, whatever it found, so a signed-in person it refuses learns
  // nothing else.
  "not-the-operator": "forbidden",

  // A high-impact act asks for a recent confirmation; confirming the second factor again is the
  // whole remedy, which a fresh sign-in alone is not.
  "confirmation-too-old": "precondition",

  // Signing in again would only meet it again: the remedy is confirming the second factor.
  "second-factor-pending": "precondition",

  // The action Postgres aborted to end a deadlock did nothing wrong: reading again and deciding
  // again is the whole remedy.
  "changed-meanwhile": "conflict",

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

  // The llm layer may import no slice. The remedy is a raised limit or a new month, never a wait,
  // so it is no `CeilingMet`.
  "spending-limit-met": "precondition",
} as const satisfies Vocabulary;

type KernelRefusalWord = Extract<keyof typeof KERNEL_REFUSALS, string>;

export type KernelRefusal<W extends KernelRefusalWord> = W;

export type RefusalWordFor<V extends Vocabulary> = KernelRefusalWord | Extract<keyof V, string>;

/**
 * Read off the vocabulary rather than restated, so a word whose class moved cannot pass unnoticed.
 */
export type KernelRefusalOfClass<C extends RefusalClass> = {
  [W in KernelRefusalWord]: (typeof KERNEL_REFUSALS)[W] extends C ? W : never;
}[KernelRefusalWord];

export const NOT_FOUND = "not-found" satisfies KernelRefusalWord;

export const MALFORMED = "malformed" satisfies KernelRefusalWord;
