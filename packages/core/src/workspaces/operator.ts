import { boundarySchemas } from "@better-answers/schema";

import { action, declareIdentitySetActions, record } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  type Claims,
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
  withOperatorRead,
} from "../store/postgres/index.ts";
import { promoting } from "./promotion.ts";
import { hashOfTyped, mintOneTimeCode } from "./recovery-codes.ts";
import { OPERATOR_RESTORE_PREFIX, SESSION_VERIFICATION_PREFIXES } from "./sign-in-and-consent.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

const OPERATOR_ACTIONS = declareIdentitySetActions("people", {
  grant: action("people.operator.granted", {}),
  revoke: action("people.operator.revoked", {}),
});

type MarkChange = keyof typeof OPERATOR_ACTIONS;

type OperatorMarkInput = {
  readonly email: string;
  readonly change: MarkChange;
};

type OperatorMarkSet = {
  readonly personId: UserId;

  /** False where the person already stood as asked, and nothing was written. */
  readonly changed: boolean;
};

type Marked = Result<OperatorMarkSet, WorkspaceRefusal<"no-such-user">>;

const marking = async (
  platform: PlatformPrincipal,
  tx: Tx,
  input: OperatorMarkInput,
): Promise<Marked> => {
  const found = await tx.query<{ id: string; operator: boolean }>(
    'SELECT id, operator FROM "user" WHERE lower(email) = lower($1) FOR UPDATE',
    [input.email],
  );
  const row = found.rows[0];
  if (row === undefined) return err("no-such-user");
  const personId = boundarySchemas.user.select.shape.id.parse(row.id);
  const operator = input.change === "grant";
  if (row.operator === operator) return ok({ personId, changed: false });

  if (operator) await promoting(tx, personId);
  await tx.query('UPDATE "user" SET operator = $2, updated_at = now() WHERE id = $1', [
    personId,
    operator,
  ]);
  await record(platform, tx, {
    id: ulid(),
    action: OPERATOR_ACTIONS[input.change],
    subjectId: personId,
    detail: {},
  });
  return ok({ personId, changed: true });
};

/**
 * Grants or revokes the operator mark of the person holding `email`, matched case-insensitively,
 * and records the change in the identity-set audit log under the platform's own actor. A person
 * already as asked is left alone, with nothing written.
 */
export const setOperatorMark = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: OperatorMarkInput,
): Promise<Result<OperatorMarkSet, WorkspaceRefusal<"no-such-user"> | Error>> => {
  const marked = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => marking(platform, tx, input)),
  );
  if (!marked.ok) return err(marked.error);
  return marked.value;
};

const RESTORE_ACTIONS = declareIdentitySetActions("people", {
  restored: action("people.person.sign_in_restored", {}),
});

const RESTORE_CODE_LIFETIME_MS = 24 * 60 * 60_000;

type RestoreSignInInput = {
  readonly email: string;
  readonly now: Date;
};

export type SignInRestored = {
  readonly personId: UserId;

  /** As the person's row holds it: where the notice goes. */
  readonly email: string;

  /** The one time it exists outside the person's hands: only its hash is kept. */
  readonly code: string;
  readonly expiresAt: Date;
};

/** The acceptor keys the code by the stored address, lowered by Postgres, so this does too. */
const HOLDING_BY_ADDRESS = `
  SELECT id, email, $2 || lower(email) AS identifier
    FROM "user" WHERE lower(email) = lower($1) FOR UPDATE`;

/** Before the sessions go: a row keyed by a session is found only through it. */
const SESSION_ROWS = `
  DELETE FROM verification
   WHERE identifier IN (SELECT prefix || s.id FROM session s, unnest($2::text[]) AS prefix
                         WHERE s.user_id = $1)`;

const HELD_BY_THE_PERSON = ["session", "passkey", "authenticator", "recovery_code"] as const;

const KEEPING_THE_CODE = `
  INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $5)`;

/** Ending every session ends every setup grant with it. */
const clearingTheFactors = async (tx: Tx, personId: UserId, now: Date): Promise<void> => {
  await tx.query(SESSION_ROWS, [personId, [...SESSION_VERIFICATION_PREFIXES]]);
  for (const table of HELD_BY_THE_PERSON) {
    await tx.query(`DELETE FROM ${table} WHERE user_id = $1`, [personId]);
  }
  await tx.query(
    'UPDATE "user" SET authenticator_enabled = false, restore_required_at = $2, updated_at = now() WHERE id = $1',
    [personId, now],
  );
};

const restoring = async (
  platform: PlatformPrincipal,
  tx: Tx,
  input: RestoreSignInInput,
): Promise<Result<SignInRestored, WorkspaceRefusal<"no-such-user">>> => {
  const found = await tx.query<{ id: string; email: string; identifier: string }>(
    HOLDING_BY_ADDRESS,
    [input.email, OPERATOR_RESTORE_PREFIX],
  );
  const row = found.rows[0];
  if (row === undefined) return err("no-such-user");
  const personId = boundarySchemas.user.select.shape.id.parse(row.id);

  await clearingTheFactors(tx, personId, input.now);
  const code = mintOneTimeCode();
  const expiresAt = new Date(input.now.getTime() + RESTORE_CODE_LIFETIME_MS);
  await tx.query("DELETE FROM verification WHERE identifier = $1", [row.identifier]);
  await tx.query(KEEPING_THE_CODE, [
    ulid(),
    row.identifier,
    hashOfTyped(code),
    expiresAt,
    input.now,
  ]);
  await record(platform, tx, {
    id: ulid(),
    action: RESTORE_ACTIONS.restored,
    subjectId: personId,
    detail: {},
  });
  return ok({ personId, email: row.email, code, expiresAt });
};

/**
 * Restores the sign-in of the person holding `email`, under their lock: their factors, codes and
 * sessions end, and setting up a factor waits on a one-time restore code. Recorded under the
 * platform's actor. Answers the code, which replaces any earlier one.
 */
export const restoreSignIn = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RestoreSignInInput,
): Promise<Result<SignInRestored, WorkspaceRefusal<"no-such-user"> | Error>> => {
  const restored = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => restoring(platform, tx, input)),
  );
  if (!restored.ok) return err(restored.error);
  return restored.value;
};

/** Every person carrying the mark, by address: where the platform writes to its operator. */
export const operatorAddresses = (
  platform: PlatformPrincipal,
  door: PostgresDoor,
): Promise<Result<readonly string[], Error>> =>
  attempt(() =>
    withIdentityRead(platform, door, async (tx) => {
      const found = await tx.query<{ email: string }>(
        'SELECT email FROM "user" WHERE operator ORDER BY email',
      );
      return found.rows.map((row) => row.email);
    }),
  );

type OperatorStanding =
  | { readonly operator: false }
  | { readonly operator: true; readonly name: string };

/**
 * Whether a signed-in person stands as the operator, by the rule every console action is resolved
 * on, and their display name where they do. It answers no rather than refusing.
 */
export const standingAsOperator = async (
  door: PostgresDoor,
  claims: Pick<Claims, "userId" | "issuedAt">,
): Promise<Result<OperatorStanding, Error>> => {
  const resolved = await attempt(() =>
    withOperatorRead(door, claims, async (operator, tx) => {
      const found = await tx.query<{ name: string }>('SELECT name FROM "user" WHERE id = $1', [
        operator.userId,
      ]);
      return found.rows[0]?.name;
    }),
  );
  if (!resolved.ok) return err(resolved.error);

  const name = resolved.value.ok ? resolved.value.value : undefined;
  return ok(name === undefined ? { operator: false } : { operator: true, name });
};
