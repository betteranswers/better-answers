import type { KernelRefusal } from "./vocabulary.ts";

/** The hour a pending session has to confirm, counted from the first request that found it pending. */
export const PENDING_SESSION_LIFETIME_MS = 60 * 60 * 1000;

/** What the gate reads of one session and its person, every fact from the store. */
export type SecondFactorFacts = {
  /** An Admin in any workspace, or the operator. */
  readonly mustHoldOne: boolean;

  /** A passkey, or an authenticator past its first code; a setup still waiting is none. */
  readonly holdsAFactor: boolean;

  /** This session carries a confirmation stamp. */
  readonly confirmed: boolean;

  /** This session spent a recovery code or gave the restore code since any restore. */
  readonly setupGranted: boolean;
};

const SECOND_FACTOR_STANDINGS = ["not-required", "confirmed", "confirm", "setup"] as const;

export type SecondFactorStanding = (typeof SECOND_FACTOR_STANDINGS)[number];

type PendingStanding = Extract<SecondFactorStanding, "confirm" | "setup">;

/**
 * Derived afresh on every request, so a role change, a removed factor or a restore takes effect on
 * the next one. A stamp counts only while the person still holds a factor to confirm with.
 */
export const standingOf = (facts: SecondFactorFacts): SecondFactorStanding => {
  if (!facts.mustHoldOne) return "not-required";
  if (facts.holdsAFactor && facts.confirmed) return "confirmed";
  return facts.holdsAFactor && !facts.setupGranted ? "confirm" : "setup";
};

/** What a pending session meets outside the pending set. */
export type SecondFactorRefusal = KernelRefusal<"second-factor-pending">;

export const isPending = (standing: SecondFactorStanding): standing is PendingStanding =>
  standing === "confirm" || standing === "setup";

export const PENDING_STEPS = [
  "read-the-session",
  "sign-out",
  "read-the-second-factor",
  "read-the-operator-standing",
  "confirm",
  "spend-a-recovery-code",
  "give-the-restore-code",
  "set-up-a-factor",
] as const;

/** One thing a pending session may still do; a transport names its paths for each. */
export type PendingStep = (typeof PENDING_STEPS)[number];

const BOTH: readonly PendingStanding[] = ["confirm", "setup"];

const SETUP_ONLY: readonly PendingStanding[] = ["setup"];

/** Setup only with nothing to confirm with, or a spent code's grant: a mailbox alone never adds a factor. */
const PENDING_SET = {
  "read-the-session": BOTH,
  "sign-out": BOTH,
  "read-the-second-factor": BOTH,
  "read-the-operator-standing": BOTH,
  confirm: BOTH,
  "spend-a-recovery-code": BOTH,
  "give-the-restore-code": BOTH,
  "set-up-a-factor": SETUP_ONLY,
} as const satisfies Record<PendingStep, readonly PendingStanding[]>;

/** Undefined: a step outside the pending set, which only a session that is not pending may take. */
export const mayTake = (standing: SecondFactorStanding, step: PendingStep | undefined): boolean =>
  !isPending(standing) || (step !== undefined && PENDING_SET[step].includes(standing));

/** What a read does to the session's pending clock: a clock, never a stored state. */
export type PendingClock = "none" | "start" | "run" | "stop" | "end";

export const pendingClockOf = (
  standing: SecondFactorStanding,
  pendingSince: Date | null,
  now: Date,
): PendingClock => {
  if (!isPending(standing)) return pendingSince === null ? "none" : "stop";
  if (pendingSince === null) return "start";
  return now.getTime() - pendingSince.getTime() > PENDING_SESSION_LIFETIME_MS ? "end" : "run";
};
