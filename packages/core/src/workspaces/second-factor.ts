import { boundarySchemas } from "@better-answers/schema";

import { act, declareIdentitySetActs, recordFor } from "../audit/index.ts";
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
import { issuingRecoveryCodes } from "./recovery-codes.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** Ids alone: an authenticator has no name, and its secret never leaves the library's row. */
const SECOND_FACTOR_ACTS = declareIdentitySetActs("people", {
  authenticatorAdded: act("people.person.authenticator_added", { authenticatorId: "id" }),
  authenticatorRemoved: act("people.person.authenticator_removed", { authenticatorId: "id" }),
});

const ADMIN: Role = "Admin";

type AuthenticatorState = "none" | "awaiting-code" | "set-up";

type Facts = {
  /** An Admin in any workspace, or the operator. */
  readonly mustHoldOne: boolean;
  readonly passkeys: number;
  readonly authenticator: AuthenticatorState;
  readonly authenticatorId: string | null;
  readonly recoveryCodes: number;
  readonly recoveryCodesMadeAt: Date | null;
};

type FactsRow = Omit<Facts, "authenticator"> & { readonly verified: boolean | null };

const FACTS = `
  SELECT u.operator OR EXISTS (SELECT 1 FROM member m WHERE m.user_id = u.id AND m.role = $2)
           AS "mustHoldOne",
         (SELECT count(*)::int FROM passkey p WHERE p.user_id = u.id) AS passkeys,
         a.id AS "authenticatorId", a.verified,
         (SELECT count(*)::int FROM recovery_code r WHERE r.user_id = u.id) AS "recoveryCodes",
         (SELECT max(r.created_at) FROM recovery_code r WHERE r.user_id = u.id)
           AS "recoveryCodesMadeAt"
    FROM "user" u LEFT JOIN authenticator a ON a.user_id = u.id
   WHERE u.id = $1 AND ${notErasedAt("u.email")}`;

const stateOf = (verified: boolean | null): AuthenticatorState => {
  if (verified === null) return "none";
  return verified ? "set-up" : "awaiting-code";
};

const factsOf = async (tx: Tx, personId: UserId): Promise<Facts | undefined> => {
  const found = await tx.query<FactsRow>(FACTS, [personId, ADMIN]);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const { verified, ...facts } = row;
  return { ...facts, authenticator: stateOf(verified) };
};

/** Stamps only the person's own session; false, having stamped nothing, for any other. */
const stamping = async (
  tx: Tx,
  input: { readonly personId: UserId; readonly sessionId: string; readonly at: Date },
): Promise<boolean> => {
  const stamped = await tx.query(
    `UPDATE session SET second_factor_confirmed_at = $3, pending_since = NULL
      WHERE id = $1 AND user_id = $2`,
    [input.sessionId, input.personId, input.at],
  );
  return stamped.rowCount === 1;
};

type SetUpInput = {
  readonly personId: string;

  /** The session the setup ended in: the library's new one when its verify swapped them. */
  readonly sessionId: string;
  readonly at: Date;
};

type AuthenticatorSetUp = {
  readonly authenticatorId: string;
  readonly stamped: boolean;

  /** Issued only to a person who held none, and shown to them once. */
  readonly recoveryCodes: readonly string[] | undefined;
};

export type RecordAuthenticatorSetUpRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "no-authenticator"
>;

type SetUpAnswer = Result<AuthenticatorSetUp, "person-gone" | "no-authenticator">;

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
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(input.personId),
    act: SECOND_FACTOR_ACTS.authenticatorAdded,
    subjectId: input.personId,
    detail: { authenticatorId: facts.authenticatorId },
  });
  const stamped = await stamping(tx, input);
  const recoveryCodes =
    facts.recoveryCodes === 0
      ? await issuingRecoveryCodes(platform, tx, input.personId)
      : undefined;
  return ok({ authenticatorId: facts.authenticatorId, stamped, recoveryCodes });
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

type Removal = Result<{ readonly authenticatorId: string }, RemoveAuthenticatorRefusal>;

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
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(personId),
    act: SECOND_FACTOR_ACTS.authenticatorRemoved,
    subjectId: personId,
    detail: { authenticatorId: facts.authenticatorId },
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
): Promise<Result<{ readonly authenticatorId: string }, RemoveAuthenticatorRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const removed = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => removing(platform, tx, personId.data)),
  );
  if (!removed.ok) return err(removed.error);
  return removed.value;
};

export type SecondFactorHeld = {
  readonly mustHoldOne: boolean;
  readonly passkeys: number;
  readonly authenticator: AuthenticatorState;
  readonly recoveryCodes: { readonly unused: number; readonly madeAt: Date } | undefined;
};

const heldOf = (facts: Facts): SecondFactorHeld => ({
  mustHoldOne: facts.mustHoldOne,
  passkeys: facts.passkeys,
  authenticator: facts.authenticator,
  recoveryCodes:
    facts.recoveryCodesMadeAt === null
      ? undefined
      : { unused: facts.recoveryCodes, madeAt: facts.recoveryCodesMadeAt },
});

/** What the person's own Sign-in section shows; nothing in it is a secret. */
export const readSecondFactor = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string },
): Promise<Result<SecondFactorHeld, WorkspaceRefusal<"malformed" | "person-gone"> | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const read = await attempt(() =>
    withIdentityRead(platform, door, (tx) => factsOf(tx, personId.data)),
  );
  if (!read.ok) return err(read.error);
  return read.value === undefined ? err("person-gone") : ok(heldOf(read.value));
};
