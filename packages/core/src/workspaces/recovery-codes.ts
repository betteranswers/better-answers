import { createHash, randomInt } from "node:crypto";

import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";
import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { action, declareIdentitySetActions, recordFor } from "../audit/index.ts";
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

const RECOVERY_CODE_ACTIONS = declareIdentitySetActions("people", {
  issued: action("people.person.recovery_codes_issued", { replaced: "flag" }),
  used: action("people.person.recovery_code_used", {}),
});

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const GROUPS_IN_A_CODE = 4;

const CHARACTERS_IN_A_GROUP = 4;

const mintGroup = (): string =>
  Array.from({ length: CHARACTERS_IN_A_GROUP }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    "",
  );

export const mintOneTimeCode = (): string =>
  Array.from({ length: GROUPS_IN_A_CODE }, mintGroup).join("-");

const asMinted = (typed: string): string => typed.toLowerCase().replaceAll(/[\s-]/g, "");

const hashOf = (code: string): string => createHash("sha256").update(code).digest("hex");

export const hashOfTyped = (typed: string): string => hashOf(asMinted(typed));

export type RecoveryCodesMade = {
  readonly recoveryCodes: readonly string[];

  readonly madeAt: string;
};

type RecoveryCodesIssued = RecoveryCodesMade & {
  readonly replaced: boolean;
};

export const issuingRecoveryCodes = async (
  platform: PlatformPrincipal,
  tx: Tx,
  personId: UserId,
  now: Date,
): Promise<RecoveryCodesIssued> => {
  const voided = await tx.query("DELETE FROM recovery_code WHERE user_id = $1", [personId]);
  const replaced = (voided.rowCount ?? 0) > 0;
  const codes = Array.from({ length: RECOVERY_CODES_IN_A_SET }, mintOneTimeCode);
  await tx.query(
    `INSERT INTO recovery_code (id, user_id, code_hash, created_at)
     SELECT id, $2, code_hash, $4 FROM unnest($1::text[], $3::text[]) AS minted (id, code_hash)`,
    [codes.map(() => ulid()), personId, codes.map(hashOfTyped), now],
  );
  await tx.query('UPDATE "user" SET recovery_codes_acknowledged = false WHERE id = $1', [personId]);
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(personId),
    action: RECOVERY_CODE_ACTIONS.issued,
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
  "malformed" | "person-gone" | "recovery-codes-held" | "restore-code-needed"
>;

type Replaced = Result<
  RecoveryCodesIssued,
  "person-gone" | "recovery-codes-held" | "restore-code-needed"
>;

const holdsASet = async (tx: Tx, personId: UserId): Promise<boolean> => {
  const held = await tx.query("SELECT 1 FROM recovery_code WHERE user_id = $1 LIMIT 1", [personId]);
  return (held.rowCount ?? 0) > 0;
};

export const restoredByTheOperator = async (tx: Tx, personId: UserId): Promise<boolean> => {
  const marked = await tx.query(
    'SELECT 1 FROM "user" WHERE id = $1 AND restore_required_at IS NOT NULL',
    [personId],
  );
  return (marked.rowCount ?? 0) > 0;
};

/**
 * The person is the one caller: a transport hands the id of the session's own person. A first set
 * is refused while one stands.
 */
export const replaceRecoveryCodes = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ReplaceRecoveryCodesInput,
): Promise<Result<RecoveryCodesIssued, ReplaceRecoveryCodesRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const issued = await attempt(() =>
    withIdentityWrite(platform, door, async (tx): Promise<Replaced> => {
      if (!(await holdThePerson(tx, personId.data))) return err("person-gone");
      if (await restoredByTheOperator(tx, personId.data)) return err("restore-code-needed");
      if (!input.replacing && (await holdsASet(tx, personId.data))) {
        return err("recovery-codes-held");
      }
      return ok(await issuingRecoveryCodes(platform, tx, personId.data, input.now));
    }),
  );
  if (!issued.ok) return err(issued.error);
  return issued.value;
};

export const spendingARecoveryCode = async (
  platform: PlatformPrincipal,
  tx: Tx,
  personId: UserId,
  typed: string,
): Promise<number | undefined> => {
  const found = await tx.query("DELETE FROM recovery_code WHERE user_id = $1 AND code_hash = $2", [
    personId,
    hashOfTyped(typed),
  ]);
  if (found.rowCount !== 1) return undefined;
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(personId),
    action: RECOVERY_CODE_ACTIONS.used,
    subjectId: personId,
    detail: {},
  });
  const left = await tx.query<{ unused: number }>(
    "SELECT count(*)::int AS unused FROM recovery_code WHERE user_id = $1",
    [personId],
  );
  // Stryker disable next-line OptionalChaining: a count(*) with no GROUP BY always answers one row
  return left.rows[0]?.unused ?? 0;
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
 * Only the set they were shown is marked: a page still showing one since replaced is refused, and
 * marks nothing.
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
