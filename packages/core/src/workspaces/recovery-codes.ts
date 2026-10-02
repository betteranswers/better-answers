import { createHash, randomInt } from "node:crypto";

import { z } from "zod";

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

export type RecoveryCodesMade = {
  readonly recoveryCodes: readonly string[];

  /** An ISO instant, as it crosses the wire: acknowledging names the set by it. */
  readonly madeAt: string;
};

type RecoveryCodesIssued = RecoveryCodesMade & {
  /** Whether a set stood before, which this one voided. */
  readonly replaced: boolean;
};

/**
 * Voids the person's codes and keeps ten new ones as hashes, answering the codes themselves: the
 * one time they exist outside the person's hands. Every row carries `now`, which names the set
 * when it is acknowledged.
 */
export const issuingRecoveryCodes = async (
  platform: PlatformPrincipal,
  tx: Tx,
  personId: UserId,
  now: Date,
): Promise<RecoveryCodesIssued> => {
  const voided = await tx.query("DELETE FROM recovery_code WHERE user_id = $1", [personId]);
  const replaced = (voided.rowCount ?? 0) > 0;
  const codes = Array.from({ length: RECOVERY_CODES_IN_A_SET }, mintRecoveryCode);
  await tx.query(
    `INSERT INTO recovery_code (id, user_id, code_hash, created_at)
     SELECT id, $2, code_hash, $4 FROM unnest($1::text[], $3::text[]) AS minted (id, code_hash)`,
    [codes.map(() => ulid()), personId, codes.map((code) => hashOf(asMinted(code))), now],
  );
  await tx.query('UPDATE "user" SET recovery_codes_acknowledged = false WHERE id = $1', [personId]);
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(personId),
    act: RECOVERY_CODE_ACTS.issued,
    subjectId: personId,
    detail: { replaced },
  });
  return { recoveryCodes: codes, madeAt: now.toISOString(), replaced };
};

type RecoveryCodesInput = { readonly personId: string };

/** Whether the caller's page offered a replacement, or a first set to someone holding none. */
export const replaceRecoveryCodesInput = z.object({ replacing: z.boolean() });

type ReplaceRecoveryCodesInput = RecoveryCodesInput &
  z.output<typeof replaceRecoveryCodesInput> & { readonly now: Date };

export type ReplaceRecoveryCodesRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "recovery-codes-held"
>;

const holdsASet = async (tx: Tx, personId: UserId): Promise<boolean> => {
  const held = await tx.query("SELECT 1 FROM recovery_code WHERE user_id = $1 LIMIT 1", [personId]);
  return (held.rowCount ?? 0) > 0;
};

/**
 * The person is the one caller: a transport hands the id of the session's own person. A caller
 * asking for a first set is refused while one stands, so a stale page never voids a set unasked.
 */
export const replaceRecoveryCodes = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ReplaceRecoveryCodesInput,
): Promise<Result<RecoveryCodesIssued, ReplaceRecoveryCodesRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const issued = await attempt(() =>
    withIdentityWrite(
      platform,
      door,
      async (tx): Promise<Result<RecoveryCodesIssued, "person-gone" | "recovery-codes-held">> => {
        if (!(await holdThePerson(tx, personId.data))) return err("person-gone");
        if (!input.replacing && (await holdsASet(tx, personId.data))) {
          return err("recovery-codes-held");
        }
        return ok(await issuingRecoveryCodes(platform, tx, personId.data, input.now));
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
        // Stryker disable next-line OptionalChaining: a count(*) with no GROUP BY always answers one row
        return ok(left.rows[0]?.unused ?? 0);
      },
    ),
  );
  if (!spent.ok) return err(spent.error);
  if (!spent.value.ok) return err(spent.value.error);
  return ok({ unused: spent.value.value });
};

/** The set the person saved, named by the instant its issue answered. */
export const acknowledgeRecoveryCodesInput = z.object({ madeAt: z.iso.datetime() });

type AcknowledgeRecoveryCodesInput = RecoveryCodesInput & { readonly madeAt: string };

export type AcknowledgeRecoveryCodesRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "changed-meanwhile"
>;

const ACKNOWLEDGING = `
  UPDATE "user" SET recovery_codes_acknowledged = true
   WHERE id = $1
     AND EXISTS (SELECT 1 FROM recovery_code r WHERE r.user_id = $1 AND r.created_at = $2)`;

/**
 * The person has saved the set, so it is never shown again. Only the set they were shown is
 * marked: a page still showing one since replaced is refused, and marks nothing.
 */
export const acknowledgeRecoveryCodes = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: AcknowledgeRecoveryCodesInput,
): Promise<Result<undefined, AcknowledgeRecoveryCodesRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  const madeAt = acknowledgeRecoveryCodesInput.shape.madeAt.safeParse(input.madeAt);
  if (!personId.success || !madeAt.success) return err("malformed");

  const marked = await attempt(() =>
    withIdentityWrite(
      platform,
      door,
      async (tx): Promise<Result<undefined, "person-gone" | "changed-meanwhile">> => {
        if (!(await holdThePerson(tx, personId.data))) return err("person-gone");
        const flagged = await tx.query(ACKNOWLEDGING, [personId.data, madeAt.data]);
        return flagged.rowCount === 1 ? ok(undefined) : err("changed-meanwhile");
      },
    ),
  );
  if (!marked.ok) return err(marked.error);
  return marked.value;
};
