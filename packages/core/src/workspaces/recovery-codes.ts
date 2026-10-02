import { createHash, randomInt } from "node:crypto";

import { boundarySchemas } from "@better-answers/schema";
import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { act, declareIdentitySetActs, recordFor } from "../audit/index.ts";
import {
  actorIdOfPerson,
  attempt,
  err,
  ok,
  type PlatformPrincipal,
  type Result,
  type UserId,
  ulid,
} from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withIdentityWrite } from "../store/postgres/index.ts";
import { holdThePerson } from "./person-lock.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

const RECOVERY_CODE_ACTS = declareIdentitySetActs("people", {
  issued: act("people.person.recovery_codes_issued", { replaced: "flag" }),
  used: act("people.person.recovery_code_used", {}),
});

/** Crockford's base32, without the letters a reader takes for a digit. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Sixteen characters carry 80 bits, past guessing from a leaked hash, so the hash needs no key. */
const GROUPS_IN_A_CODE = 4;

const CHARACTERS_IN_A_GROUP = 4;

const mintGroup = (): string =>
  Array.from({ length: CHARACTERS_IN_A_GROUP }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    "",
  );

const mintRecoveryCode = (): string =>
  Array.from({ length: GROUPS_IN_A_CODE }, mintGroup).join("-");

/** What a person types, as it was minted: no spaces, no dashes, lower case. */
const asMinted = (typed: string): string => typed.toLowerCase().replaceAll(/[\s-]/g, "");

const hashOf = (code: string): string => createHash("sha256").update(code).digest("hex");

type RecoveryCodesIssued = {
  readonly recoveryCodes: readonly string[];

  /** Whether a set stood before, which this one voided. */
  readonly replaced: boolean;
};

/**
 * Voids the person's codes and keeps ten new ones as hashes, answering the codes themselves: the
 * one time they exist outside the person's hands. The new set waits to be acknowledged.
 */
export const issuingRecoveryCodes = async (
  platform: PlatformPrincipal,
  tx: Tx,
  personId: UserId,
): Promise<RecoveryCodesIssued> => {
  const voided = await tx.query("DELETE FROM recovery_code WHERE user_id = $1", [personId]);
  const replaced = (voided.rowCount ?? 0) > 0;
  const codes = Array.from({ length: RECOVERY_CODES_IN_A_SET }, mintRecoveryCode);
  await tx.query(
    `INSERT INTO recovery_code (id, user_id, code_hash)
     SELECT id, $2, code_hash FROM unnest($1::text[], $3::text[]) AS minted (id, code_hash)`,
    [codes.map(() => ulid()), personId, codes.map((code) => hashOf(asMinted(code)))],
  );
  await tx.query('UPDATE "user" SET recovery_codes_acknowledged = false WHERE id = $1', [personId]);
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(personId),
    act: RECOVERY_CODE_ACTS.issued,
    subjectId: personId,
    detail: { replaced },
  });
  return { recoveryCodes: codes, replaced };
};

type RecoveryCodesInput = { readonly personId: string };

export type RecoveryCodesRefusal = WorkspaceRefusal<"malformed" | "person-gone">;

/** The person is the one caller: a transport hands the id of the session's own person. */
export const replaceRecoveryCodes = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RecoveryCodesInput,
): Promise<Result<RecoveryCodesIssued, RecoveryCodesRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const issued = await attempt(() =>
    withIdentityWrite(
      platform,
      door,
      async (tx): Promise<Result<RecoveryCodesIssued, "person-gone">> => {
        if (!(await holdThePerson(tx, personId.data))) return err("person-gone");
        return ok(await issuingRecoveryCodes(platform, tx, personId.data));
      },
    ),
  );
  if (!issued.ok) return err(issued.error);
  return issued.value;
};

type SpendRecoveryCodeInput = RecoveryCodesInput & { readonly code: string };

export type SpendRecoveryCodeRefusal = WorkspaceRefusal<"malformed" | "recovery-code-wrong">;

/**
 * A conditional delete spends the code, so of two spends at once only one finds it. Only a stored
 * hash matches, so anything else typed is wrong in the same word.
 */
export const spendRecoveryCode = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SpendRecoveryCodeInput,
): Promise<Result<{ readonly unused: number }, SpendRecoveryCodeRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");
  const code = asMinted(input.code);

  const spent = await attempt(() =>
    withIdentityWrite(
      platform,
      door,
      async (tx): Promise<Result<number, "recovery-code-wrong">> => {
        const found = await tx.query(
          "DELETE FROM recovery_code WHERE user_id = $1 AND code_hash = $2",
          [personId.data, hashOf(code)],
        );
        if (found.rowCount !== 1) return err("recovery-code-wrong");
        await recordFor(platform, tx, {
          id: ulid(),
          actor: actorIdOfPerson(personId.data),
          act: RECOVERY_CODE_ACTS.used,
          subjectId: personId.data,
          detail: {},
        });
        const left = await tx.query<{ unused: number }>(
          "SELECT count(*)::int AS unused FROM recovery_code WHERE user_id = $1",
          [personId.data],
        );
        return ok(left.rows[0]?.unused ?? 0);
      },
    ),
  );
  if (!spent.ok) return err(spent.error);
  if (!spent.value.ok) return err(spent.value.error);
  return ok({ unused: spent.value.value });
};

/** The person has saved the set, so it is never shown again. */
export const acknowledgeRecoveryCodes = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RecoveryCodesInput,
): Promise<Result<undefined, RecoveryCodesRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const marked = await attempt(() =>
    withIdentityWrite(platform, door, (tx) =>
      tx.query('UPDATE "user" SET recovery_codes_acknowledged = true WHERE id = $1', [
        personId.data,
      ]),
    ),
  );
  if (!marked.ok) return err(marked.error);
  return marked.value.rowCount === 1 ? ok(undefined) : err("person-gone");
};
