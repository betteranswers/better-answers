import { boundarySchemas } from "@better-answers/schema";

import {
  act,
  type AuditEvent,
  type AuditAct,
  declareIdentitySetActs,
  recordFor,
} from "../audit/index.ts";
import {
  actorIdOfPerson,
  attempt,
  err,
  ok,
  type PlatformPrincipal,
  type Result,
  type Role,
  type UserId,
  ulid,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityRead,
  withIdentityWrite,
} from "../store/postgres/index.ts";
import { notErasedAt } from "./display-name.ts";
import { holdThePerson } from "./person-lock.ts";
import { issuingRecoveryCodes, type RecoveryCodesMade } from "./recovery-codes.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** Ids alone: an authenticator has no name, and its secret never leaves the library's row. */
const SECOND_FACTOR_ACTS = declareIdentitySetActs("people", {
  authenticatorAdded: act("people.person.authenticator_added", { authenticatorId: "id" }),
  authenticatorRemoved: act("people.person.authenticator_removed", { authenticatorId: "id" }),
});

const ADMIN: Role = "Admin";

/** A person's act on their own second factor: they are its actor and its subject. */
export const recordingTheirOwn = async <A extends AuditAct>(
  platform: PlatformPrincipal,
  tx: Tx,
  personId: UserId,
  act: A,
  detail: AuditEvent<A>["detail"],
): Promise<void> => {
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(personId),
    act,
    subjectId: personId,
    detail,
  });
};

type AuthenticatorState = "none" | "awaiting-code" | "set-up";

type Facts = {
  /** An Admin in any workspace, or the operator. */
  readonly mustHoldOne: boolean;
  readonly passkeys: number;
  readonly authenticator: AuthenticatorState;
  readonly authenticatorId: string | null;
  readonly recoveryCodes: number;
  readonly recoveryCodesMadeAt: Date | null;
  readonly passkeyOfferDismissed: boolean;
};

type FactsRow = Omit<Facts, "authenticator"> & { readonly verified: boolean | null };

const FACTS = `
  SELECT u.operator OR EXISTS (SELECT 1 FROM member m WHERE m.user_id = u.id AND m.role = $2)
           AS "mustHoldOne",
         (SELECT count(*)::int FROM passkey p WHERE p.user_id = u.id) AS passkeys,
         a.id AS "authenticatorId", a.verified,
         codes.held AS "recoveryCodes", codes.made AS "recoveryCodesMadeAt",
         u.passkey_offer_dismissed_at IS NOT NULL AS "passkeyOfferDismissed"
    FROM "user" u LEFT JOIN authenticator a ON a.user_id = u.id
   CROSS JOIN LATERAL (SELECT count(*)::int AS held, max(r.created_at) AS made
                         FROM recovery_code r WHERE r.user_id = u.id) codes
   WHERE u.id = $1 AND ${notErasedAt("u.email")}`;

const stateOf = (verified: boolean | null): AuthenticatorState => {
  if (verified === null) return "none";
  return verified ? "set-up" : "awaiting-code";
};

export const factsOf = async (tx: Tx, personId: UserId): Promise<Facts | undefined> => {
  const found = await tx.query<FactsRow>(FACTS, [personId, ADMIN]);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const { verified, ...facts } = row;
  return { ...facts, authenticator: stateOf(verified) };
};

/** Stamps only the person's own session; false, having stamped nothing, for any other. */
export const stamping = async (
  tx: Tx,
  input: SetUpInput & { readonly personId: UserId },
): Promise<boolean> => {
  const stamped = await tx.query(
    `UPDATE session SET second_factor_confirmed_at = $3, pending_since = NULL,
                        created_at = LEAST(created_at, $4), expires_at = LEAST(expires_at, $5)
      WHERE id = $1 AND user_id = $2`,
    [input.sessionId, input.personId, input.at, input.carried.createdAt, input.carried.expiresAt],
  );
  return stamped.rowCount === 1;
};

export type SetUpInput = {
  readonly personId: string;

  /** The session the setup ended in: the library's new one when its verify swapped them. */
  readonly sessionId: string;
  readonly at: Date;

  /**
   * The age of the session the setup began in: revocation and freshness date from creation, so a
   * swapped-in session is made no younger.
   */
  readonly carried: { readonly createdAt: Date; readonly expiresAt: Date };
};

type AuthenticatorSetUp = {
  readonly authenticatorId: string;
  readonly stamped: boolean;

  /** False when another finish recorded this authenticator first, so this one sends no notice. */
  readonly firstRecord: boolean;

  /** Issued only to a person who held none, and shown to them once. */
  readonly issued: RecoveryCodesMade | undefined;
};

export type RecordAuthenticatorSetUpRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "no-authenticator"
>;

type SetUpAnswer = Result<AuthenticatorSetUp, "person-gone" | "no-authenticator">;

/**
 * Two finishes at once can both pass the route's check: the second waits on the lock, then finds
 * the first's row and records nothing.
 */
const recordingOnce = async (
  platform: PlatformPrincipal,
  tx: Tx,
  personId: UserId,
  authenticatorId: string,
): Promise<boolean> => {
  const recorded = await tx.query(
    `SELECT 1 FROM identity_audit_event
      WHERE subject_kind = split_part($2, '.', 2) AND subject_id = $1 AND act = $2
        AND detail->>'authenticatorId' = $3`,
    [personId, SECOND_FACTOR_ACTS.authenticatorAdded.name, authenticatorId],
  );
  if ((recorded.rowCount ?? 0) > 0) return false;
  await recordingTheirOwn(platform, tx, personId, SECOND_FACTOR_ACTS.authenticatorAdded, {
    authenticatorId,
  });
  return true;
};

const settingUp = async (
  platform: PlatformPrincipal,
  tx: Tx,
  input: SetUpInput & { readonly personId: UserId },
): Promise<SetUpAnswer> => {
  if (!(await holdThePerson(tx, input.personId))) return err("person-gone");
  const facts = await factsOf(tx, input.personId);
  if (facts?.authenticator !== "set-up" || facts.authenticatorId === null) {
    return err("no-authenticator");
  }
  const firstRecord = await recordingOnce(platform, tx, input.personId, facts.authenticatorId);
  const stamped = await stamping(tx, input);
  const issued =
    facts.recoveryCodes === 0
      ? await issuingRecoveryCodes(platform, tx, input.personId, input.at)
      : undefined;
  return ok({ authenticatorId: facts.authenticatorId, stamped, firstRecord, issued });
};

/**
 * Called once the library has verified the person's first code: records the authenticator, counts
 * the setup as the session's confirmation, and issues recovery codes to a person who holds none.
 */
export const recordAuthenticatorSetUp = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SetUpInput,
): Promise<Result<AuthenticatorSetUp, RecordAuthenticatorSetUpRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const set = await attempt(() =>
    withIdentityWrite(platform, door, (tx) =>
      settingUp(platform, tx, { ...input, personId: personId.data }),
    ),
  );
  if (!set.ok) return err(set.error);
  return set.value;
};

export type RemoveAuthenticatorRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "no-authenticator" | "last-second-factor"
>;

type AuthenticatorRemoved = { readonly authenticatorId: string };

type Removal = Result<AuthenticatorRemoved, RemoveAuthenticatorRefusal>;

const removing = async (
  platform: PlatformPrincipal,
  tx: Tx,
  personId: UserId,
): Promise<Removal> => {
  if (!(await holdThePerson(tx, personId))) return err("person-gone");
  const facts = await factsOf(tx, personId);
  if (facts?.authenticator !== "set-up" || facts.authenticatorId === null) {
    return err("no-authenticator");
  }
  if (facts.mustHoldOne && facts.passkeys === 0) return err("last-second-factor");
  await tx.query("DELETE FROM authenticator WHERE id = $1", [facts.authenticatorId]);
  await tx.query('UPDATE "user" SET authenticator_enabled = false WHERE id = $1', [personId]);
  await recordingTheirOwn(platform, tx, personId, SECOND_FACTOR_ACTS.authenticatorRemoved, {
    authenticatorId: facts.authenticatorId,
  });
  return ok({ authenticatorId: facts.authenticatorId });
};

/**
 * The person is the one caller. An Admin in any workspace, or the operator, keeps their last
 * second factor: the check runs under the person's lock, so two removals cannot each leave one.
 */
export const removeAuthenticator = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string },
): Promise<Result<AuthenticatorRemoved, RemoveAuthenticatorRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const removed = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => removing(platform, tx, personId.data)),
  );
  if (!removed.ok) return err(removed.error);
  return removed.value;
};

/** Every instant is ISO, as it crosses the wire; a passkey never used has no last use. */
type PasskeyHeld = {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
};

type PasskeyRow = Omit<PasskeyHeld, "createdAt" | "lastUsedAt"> & {
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
};

const PASSKEYS = `
  SELECT p.id, p.name, p.created_at AS "createdAt", l.at AS "lastUsedAt"
    FROM passkey p LEFT JOIN passkey_last_use l ON l.passkey_id = p.id
   WHERE p.user_id = $1
   ORDER BY p.created_at, p.id`;

const passkeysOf = async (tx: Tx, personId: UserId): Promise<readonly PasskeyHeld[]> =>
  (await tx.query<PasskeyRow>(PASSKEYS, [personId])).rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));

export type SecondFactorHeld = {
  readonly mustHoldOne: boolean;
  readonly passkeys: readonly PasskeyHeld[];
  readonly authenticator: AuthenticatorState;
  /** `madeAt` is an ISO instant, as it crosses the wire. */
  readonly recoveryCodes: { readonly unused: number; readonly madeAt: string } | undefined;
  readonly passkeyOfferDismissed: boolean;
};

const heldOf = (facts: Facts, passkeys: readonly PasskeyHeld[]): SecondFactorHeld => ({
  mustHoldOne: facts.mustHoldOne,
  passkeys,
  authenticator: facts.authenticator,
  recoveryCodes:
    facts.recoveryCodesMadeAt === null
      ? undefined
      : { unused: facts.recoveryCodes, madeAt: facts.recoveryCodesMadeAt.toISOString() },
  passkeyOfferDismissed: facts.passkeyOfferDismissed,
});

const reading = async (tx: Tx, personId: UserId): Promise<SecondFactorHeld | undefined> => {
  const facts = await factsOf(tx, personId);
  return facts === undefined ? undefined : heldOf(facts, await passkeysOf(tx, personId));
};

/** What the person's own Sign-in section shows; nothing in it is a secret. */
export const readSecondFactor = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string },
): Promise<Result<SecondFactorHeld, WorkspaceRefusal<"malformed" | "person-gone"> | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const read = await attempt(() =>
    withIdentityRead(platform, door, (tx) => reading(tx, personId.data)),
  );
  if (!read.ok) return err(read.error);
  return read.value === undefined ? err("person-gone") : ok(read.value);
};
