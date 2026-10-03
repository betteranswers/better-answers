import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";
import { THROTTLED_KINDS } from "@better-answers/schema/second-factor";

import { act, declareIdentitySetActs, type SecondFactor } from "../audit/index.ts";
import {
  attempt,
  CeilingMet,
  err,
  ok,
  type PlatformPrincipal,
  type Result,
  type UserId,
  ulid,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityRead,
  withIdentityWrite,
} from "../store/postgres/index.ts";
import {
  type Counted,
  countingAFailure,
  resettingTheThrottle,
  type ThrottledKind,
  waitsOf,
} from "./confirm-throttle.ts";
import { holdThePerson } from "./person-lock.ts";
import {
  hashOfTyped,
  issuingRecoveryCodes,
  type RecoveryCodesMade,
  restoredByTheOperator,
  spendingARecoveryCode,
} from "./recovery-codes.ts";
import { factsOf, recordingTheirOwn, SETUP_GRANTED, stamping } from "./second-factor.ts";
import { AUTHENTICATOR_SECRET_PREFIX, OPERATOR_RESTORE_PREFIX } from "./sign-in-and-consent.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** The factor's kind alone: which passkey or code was used is no change to any factor. */
const CONFIRMING_ACTS = declareIdentitySetActs("people", {
  confirmed: act("people.person.second_factor_confirmed", { method: "secondFactor" }),
  replaced: act("people.person.factors_replaced", { by: "secondFactor" }),
  restoreAccepted: act("people.person.restore_code_accepted", {}),
});

/** How long a replacement setup's sealed secret waits for its first working code. */
const PARKED_FOR_MS = 10 * 60_000;

type Confirm = {
  readonly personId: string;
  readonly sessionId: string;
  readonly now: Date;
};

type Held = Confirm & { readonly personId: UserId };

type Gone = "person-gone" | "session-gone";

const HOLDING_THE_SESSION = `
  SELECT ${SETUP_GRANTED} AS "setupGranted"
    FROM session WHERE id = $1 AND user_id = $2 FOR UPDATE`;

/**
 * Person, then session, in every act here, so none holds what another waits on. A held session
 * cannot be signed out before the stamp lands.
 */
const holding = async (
  tx: Tx,
  held: Held,
): Promise<Result<{ readonly setupGranted: boolean }, Gone>> => {
  if (!(await holdThePerson(tx, held.personId))) return err("person-gone");
  const session = await tx.query<{ setupGranted: boolean }>(HOLDING_THE_SESSION, [
    held.sessionId,
    held.personId,
  ]);
  const row = session.rows[0];
  return row === undefined ? err("session-gone") : ok(row);
};

const holdingTheGrant = async (
  tx: Tx,
  held: Held,
): Promise<Result<undefined, Gone | "setup-not-granted">> => {
  const session = await holding(tx, held);
  if (!session.ok) return session;
  return session.value.setupGranted ? ok(undefined) : err("setup-not-granted");
};

/** The person's id is refused once, where it enters; the work runs in one transaction. */
const asThePerson = async <T, R>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: Confirm,
  work: (tx: Tx, held: Held) => Promise<Result<T, R>>,
): Promise<Result<T, R | "malformed" | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const done = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => work(tx, { ...input, personId: personId.data })),
  );
  if (!done.ok) return err(done.error);
  return done.value;
};

/** Either factor proves the person, so it forgets the authenticator's failures as a code would. */
const confirming = async (
  platform: PlatformPrincipal,
  tx: Tx,
  held: Held,
  method: SecondFactor,
): Promise<void> => {
  await stamping(tx, { sessionId: held.sessionId, personId: held.personId, at: held.now });
  await resettingTheThrottle(tx, held.personId, ["authenticator"]);
  await recordingTheirOwn(platform, tx, held.personId, CONFIRMING_ACTS.confirmed, { method });
};

const passkeyAssertion = z.object({
  credentialId: z.string().min(1),
  counter: z.number().int().nonnegative(),
});

const PASSKEY_USED = `
  UPDATE passkey SET counter = $3 WHERE credential_id = $1 AND user_id = $2 RETURNING id`;

const LAST_USE = `
  INSERT INTO passkey_last_use (passkey_id, at) VALUES ($1, $2)
  ON CONFLICT (passkey_id) DO UPDATE SET at = EXCLUDED.at`;

export type ConfirmByPasskeyRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "session-gone" | "passkey-not-yours"
>;

/**
 * Called once the api has verified an assertion against its own challenge. Only the person's own
 * credential confirms, and it stamps the session the person already holds: no session is made.
 */
export const confirmByPasskey = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: Confirm & z.input<typeof passkeyAssertion>,
): Promise<Result<undefined, ConfirmByPasskeyRefusal | Error>> => {
  const assertion = passkeyAssertion.safeParse(input);
  if (!assertion.success) return err("malformed");

  return asThePerson(
    platform,
    door,
    input,
    async (tx, held): Promise<Result<undefined, Gone | "passkey-not-yours">> => {
      const session = await holding(tx, held);
      if (!session.ok) return session;
      const used = await tx.query<{ id: string }>(PASSKEY_USED, [
        assertion.data.credentialId,
        held.personId,
        assertion.data.counter,
      ]);
      const passkey = used.rows[0];
      if (passkey === undefined) return err("passkey-not-yours");
      await tx.query(LAST_USE, [passkey.id, held.now]);
      await confirming(platform, tx, held, "passkey");
      return ok(undefined);
    },
  );
};

export type ConfirmByAuthenticatorRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "session-gone" | "no-authenticator"
>;

/** Called once the library has verified a code against the person's authenticator. */
export const confirmByAuthenticator = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: Confirm,
): Promise<Result<undefined, ConfirmByAuthenticatorRefusal | Error>> =>
  asThePerson(
    platform,
    door,
    input,
    async (tx, held): Promise<Result<undefined, Gone | "no-authenticator">> => {
      const session = await holding(tx, held);
      if (!session.ok) return session;
      const facts = await factsOf(tx, held.personId);
      if (facts?.authenticator !== "set-up") return err("no-authenticator");
      await confirming(platform, tx, held, "authenticator");
      return ok(undefined);
    },
  );

type WrongCodeRefusal = WorkspaceRefusal<"recovery-code-wrong" | "restore-code-wrong">;

/** Not a refusal: the failure it counts must commit, and the notice it may make due goes with it. */
type Wrong = { readonly granted: false; readonly refusal: WrongCodeRefusal } & Counted;

type CodeKind = {
  readonly kind: Extract<ThrottledKind, "recovery-code" | "restore-code">;
  readonly refusal: WrongCodeRefusal;
};

const RECOVERY_CODE: CodeKind = { kind: "recovery-code", refusal: "recovery-code-wrong" };

const RESTORE_CODE: CodeKind = { kind: "restore-code", refusal: "restore-code-wrong" };

const GRANTING = "UPDATE session SET setup_granted_at = $3 WHERE id = $1 AND user_id = $2";

/**
 * Run once the person and session are held. A kind still waiting refuses even the right code, so
 * no guess is spent while it waits.
 */
const tryingACode = async <Accepted>(
  tx: Tx,
  held: Held,
  code: CodeKind,
  check: () => Promise<Accepted | undefined>,
): Promise<Result<Accepted | Wrong, CeilingMet>> => {
  const waitSeconds = (await waitsOf(tx, held.personId, held.now))[code.kind];
  if (waitSeconds > 0) return err(new CeilingMet(waitSeconds));
  const accepted = await check();
  if (accepted === undefined) {
    const counted = await countingAFailure(tx, held.personId, code.kind, held.now);
    return ok({ granted: false, refusal: code.refusal, ...counted });
  }
  await tx.query(GRANTING, [held.sessionId, held.personId, held.now]);
  await resettingTheThrottle(tx, held.personId, [code.kind]);
  return ok(accepted);
};

type CodeInput = Confirm & { readonly code: string };

export type CodeRefusal = WorkspaceRefusal<"malformed" | "person-gone" | "session-gone">;

export type SpendRecoveryCodeRefusal = CodeRefusal | WorkspaceRefusal<"restore-code-needed">;

type Spent = { readonly granted: true; readonly unused: number } | Wrong;

type Spending = Result<Spent, Gone | "restore-code-needed" | CeilingMet>;

/**
 * Spends one of the person's recovery codes in place of their second factor. Only this session
 * may then replace the factors, and it is still unconfirmed until it has.
 */
export const spendRecoveryCode = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: CodeInput,
): Promise<Result<Spent, SpendRecoveryCodeRefusal | CeilingMet | Error>> =>
  asThePerson(platform, door, input, async (tx, held): Promise<Spending> => {
    const session = await holding(tx, held);
    if (!session.ok) return session;
    // A restore stands for the operator's own check, which a code from the mailbox must not skip.
    if (await restoredByTheOperator(tx, held.personId)) return err("restore-code-needed");
    return tryingACode(tx, held, RECOVERY_CODE, async () => {
      const unused = await spendingARecoveryCode(platform, tx, held.personId, input.code);
      return unused === undefined ? undefined : { granted: true as const, unused };
    });
  });

/** Only while the restore stands, before the code's day is out, and once. */
const CONSUMING_THE_RESTORE = `
  DELETE FROM verification v USING "user" u
   WHERE u.id = $1 AND u.restore_required_at IS NOT NULL
     AND v.identifier = $2 || lower(u.email) AND v.value = $3 AND v.expires_at > $4`;

type Accepted = { readonly granted: true } | Wrong;

type Accepting = Result<Accepted, Gone | CeilingMet>;

/** Accepts the operator's restore code; like a spent recovery code, it lets only this session set up a factor. */
export const acceptRestoreCode = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: CodeInput,
): Promise<Result<Accepted, CodeRefusal | CeilingMet | Error>> =>
  asThePerson(platform, door, input, async (tx, held): Promise<Accepting> => {
    const session = await holding(tx, held);
    if (!session.ok) return session;
    return tryingACode(tx, held, RESTORE_CODE, async () => {
      const consumed = await tx.query(CONSUMING_THE_RESTORE, [
        held.personId,
        OPERATOR_RESTORE_PREFIX,
        hashOfTyped(input.code),
        held.now,
      ]);
      if (consumed.rowCount === 0) return undefined;
      await recordingTheirOwn(platform, tx, held.personId, CONFIRMING_ACTS.restoreAccepted, {});
      return { granted: true as const };
    });
  });

const parkedUnder = (sessionId: string): string => `${AUTHENTICATOR_SECRET_PREFIX}${sessionId}`;

const PARKING = `
  INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $5)`;

export type ParkAuthenticatorSecretRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "session-gone" | "setup-not-granted"
>;

/**
 * Parks a replacement authenticator's secret, sealed by the api, until its first code works. A
 * session parks one at a time: a later setup replaces the earlier.
 */
export const parkAuthenticatorSecret = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: Confirm & { readonly encryptedSecret: string },
): Promise<Result<undefined, ParkAuthenticatorSecretRefusal | Error>> =>
  asThePerson(
    platform,
    door,
    input,
    async (tx, held): Promise<Result<undefined, Gone | "setup-not-granted">> => {
      const granted = await holdingTheGrant(tx, held);
      if (!granted.ok) return granted;
      const identifier = parkedUnder(held.sessionId);
      await tx.query("DELETE FROM verification WHERE identifier = $1", [identifier]);
      await tx.query(PARKING, [
        ulid(),
        identifier,
        input.encryptedSecret,
        new Date(held.now.getTime() + PARKED_FOR_MS),
        held.now,
      ]);
      return ok(undefined);
    },
  );

/** The sealed secret this session parked, while it lasts; reading it leaves it parked. */
export const readParkedAuthenticatorSecret = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly sessionId: string; readonly now: Date },
): Promise<Result<string | undefined, Error>> => {
  const read = await attempt(() =>
    withIdentityRead(platform, door, (tx) =>
      tx.query<{ value: string }>(
        "SELECT value FROM verification WHERE identifier = $1 AND expires_at > $2",
        [parkedUnder(input.sessionId), input.now],
      ),
    ),
  );
  return read.ok ? ok(read.value.rows[0]?.value) : err(read.error);
};

const REMOVING_THE_PASSKEYS = "DELETE FROM passkey WHERE user_id = $1 AND id IS DISTINCT FROM $2";

const removingTheOldFactors = async (
  tx: Tx,
  personId: UserId,
  keptPasskeyId: string | null,
): Promise<void> => {
  await tx.query(REMOVING_THE_PASSKEYS, [personId, keptPasskeyId]);
  await tx.query("DELETE FROM authenticator WHERE user_id = $1", [personId]);
};

const keepingThePasskey = async (
  tx: Tx,
  held: Held,
  keptPasskeyId: string,
): Promise<Result<undefined, "no-passkey">> => {
  const kept = await tx.query("SELECT 1 FROM passkey WHERE id = $1 AND user_id = $2", [
    keptPasskeyId,
    held.personId,
  ]);
  if (kept.rowCount === 0) return err("no-passkey");
  await removingTheOldFactors(tx, held.personId, keptPasskeyId);
  return ok(undefined);
};

/** The columns the library writes, so its own verify reads the secret as one it set up. */
const INSTALLING = `
  INSERT INTO authenticator (id, secret, backup_codes, user_id, verified)
  VALUES ($1, $2, '', $3, true)`;

/** Only the secret parked under this session's grant, so the one installed is the one its code proved. */
const installingTheAuthenticator = async (
  tx: Tx,
  held: Held,
  encryptedSecret: string,
): Promise<Result<undefined, "changed-meanwhile">> => {
  const parked = await tx.query(
    "DELETE FROM verification WHERE identifier = $1 AND value = $2 AND expires_at > $3",
    [parkedUnder(held.sessionId), encryptedSecret, held.now],
  );
  if (parked.rowCount === 0) return err("changed-meanwhile");
  await removingTheOldFactors(tx, held.personId, null);
  await tx.query(INSTALLING, [ulid(), encryptedSecret, held.personId]);
  return ok(undefined);
};

type Replacement =
  | { readonly by: "passkey"; readonly keptPasskeyId: string }
  | { readonly by: "authenticator"; readonly encryptedSecret: string };

type Replaced = { readonly issued: RecoveryCodesMade };

const REPLACED_FLAGS = `
  UPDATE "user" SET authenticator_enabled = $2, restore_required_at = NULL WHERE id = $1`;

/** Every session's grant goes: one left standing could replace the new factor unconfirmed. */
const finishingTheReplacement = async (
  platform: PlatformPrincipal,
  tx: Tx,
  held: Held,
  by: SecondFactor,
): Promise<Replaced> => {
  await tx.query(REPLACED_FLAGS, [held.personId, by === "authenticator"]);
  await tx.query("UPDATE session SET setup_granted_at = NULL WHERE user_id = $1", [held.personId]);
  await tx.query("DELETE FROM verification WHERE identifier = $1", [parkedUnder(held.sessionId)]);
  const issued = await issuingRecoveryCodes(platform, tx, held.personId, held.now);
  await stamping(tx, { sessionId: held.sessionId, personId: held.personId, at: held.now });
  await resettingTheThrottle(tx, held.personId, THROTTLED_KINDS);
  await recordingTheirOwn(platform, tx, held.personId, CONFIRMING_ACTS.replaced, { by });
  return { issued: { recoveryCodes: issued.recoveryCodes, madeAt: issued.madeAt } };
};

const replacing = async (
  platform: PlatformPrincipal,
  tx: Tx,
  held: Held,
  replacement: Replacement,
): Promise<Result<Replaced, Gone | "setup-not-granted" | "no-passkey" | "changed-meanwhile">> => {
  const granted = await holdingTheGrant(tx, held);
  if (!granted.ok) return granted;
  const kept =
    replacement.by === "passkey"
      ? await keepingThePasskey(tx, held, replacement.keptPasskeyId)
      : await installingTheAuthenticator(tx, held, replacement.encryptedSecret);
  if (!kept.ok) return kept;
  return ok(await finishingTheReplacement(platform, tx, held, replacement.by));
};

export type ReplaceFactorsRefusal = WorkspaceRefusal<
  | "malformed"
  | "person-gone"
  | "session-gone"
  | "setup-not-granted"
  | "no-passkey"
  | "changed-meanwhile"
>;

/**
 * Finishes a granted session's setup with the passkey the library just kept: every other passkey
 * and the authenticator go, and ten fresh codes come back to be shown once.
 */
export const replaceFactorsByPasskey = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: Confirm & { readonly keptPasskeyId: string },
): Promise<Result<Replaced, ReplaceFactorsRefusal | Error>> =>
  asThePerson(platform, door, input, (tx, held) =>
    replacing(platform, tx, held, { by: "passkey", keptPasskeyId: input.keptPasskeyId }),
  );

/**
 * Finishes a granted session's setup with the authenticator secret it parked, once the api has
 * checked a code against it: every passkey and the old authenticator go, ten fresh codes come back.
 */
export const replaceFactorsByAuthenticator = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: Confirm & { readonly encryptedSecret: string },
): Promise<Result<Replaced, ReplaceFactorsRefusal | Error>> =>
  asThePerson(platform, door, input, (tx, held) =>
    replacing(platform, tx, held, { by: "authenticator", encryptedSecret: input.encryptedSecret }),
  );
