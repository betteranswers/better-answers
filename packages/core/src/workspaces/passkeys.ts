import { z } from "zod";

import { boundarySchemas, ULID } from "@better-answers/schema";
import { PASSKEY_NAME_MAX_LENGTH } from "@better-answers/schema/second-factor";

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
import { notErasedAt } from "./display-name.ts";
import { holdThePerson } from "./person-lock.ts";
import { issuingRecoveryCodes, type RecoveryCodesMade } from "./recovery-codes.ts";
import { factsOf, type SetUpInput, stamping } from "./second-factor.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** Ids alone: the log is append-only, so a name a person later changes never lands in it. */
const PASSKEY_ACTS = declareIdentitySetActs("people", {
  passkeyAdded: act("people.person.passkey_added", { passkeyId: "id" }),
  passkeyRenamed: act("people.person.passkey_renamed", { passkeyId: "id" }),
  passkeyRemoved: act("people.person.passkey_removed", { passkeyId: "id" }),
});

const passkeyId = z.string().regex(ULID);

/** A browser's own field sends no control character, so one here came from a script. */
const CONTROL_CHARACTER = /\p{Cc}/u;

type PasskeyNameRefusal = WorkspaceRefusal<
  "passkey-name-empty" | "passkey-name-too-long" | "malformed"
>;

/** Answers the name trimmed, the form to store; every rule reads the trimmed name. */
export const applyPasskeyNameRule = (asked: string): Result<string, PasskeyNameRefusal> => {
  const name = asked.trim();
  if (name === "") return err("passkey-name-empty");
  if (CONTROL_CHARACTER.test(name)) return err("malformed");
  if (Array.from(name).length > PASSKEY_NAME_MAX_LENGTH) return err("passkey-name-too-long");
  return ok(name);
};

type Ids = { readonly personId: UserId; readonly passkeyId: string };

/** Each id as the boundary names it, or nothing: a caller's id is never trusted to be well formed. */
const idsOf = (input: { readonly personId: string; readonly passkeyId: string }) => {
  const person = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  const passkey = passkeyId.safeParse(input.passkeyId);
  return person.success && passkey.success
    ? { personId: person.data, passkeyId: passkey.data }
    : undefined;
};

const holds = async (tx: Tx, ids: Ids): Promise<boolean> => {
  const held = await tx.query("SELECT 1 FROM passkey WHERE id = $1 AND user_id = $2", [
    ids.passkeyId,
    ids.personId,
  ]);
  return (held.rowCount ?? 0) > 0;
};

const recording = async (
  platform: PlatformPrincipal,
  tx: Tx,
  ids: Ids,
  act: (typeof PASSKEY_ACTS)[keyof typeof PASSKEY_ACTS],
): Promise<void> => {
  await recordFor(platform, tx, {
    id: ulid(),
    actor: actorIdOfPerson(ids.personId),
    act,
    subjectId: ids.personId,
    detail: { passkeyId: ids.passkeyId },
  });
};

type PasskeyAdded = {
  readonly passkeyId: string;
  readonly stamped: boolean;

  /** Issued only to a person who must hold a factor and held no codes, and shown to them once. */
  readonly issued: RecoveryCodesMade | undefined;
};

export type RecordPasskeyAddedRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "no-passkey"
>;

type AddedAnswer = Result<PasskeyAdded, "person-gone" | "no-passkey">;

const recordingAdded = async (
  platform: PlatformPrincipal,
  tx: Tx,
  input: SetUpInput & Ids,
): Promise<AddedAnswer> => {
  if (!(await holdThePerson(tx, input.personId))) return err("person-gone");
  if (!(await holds(tx, input))) return err("no-passkey");
  await recording(platform, tx, input, PASSKEY_ACTS.passkeyAdded);
  const stamped = await stamping(tx, input);
  const facts = await factsOf(tx, input.personId);
  const issued =
    facts?.mustHoldOne === true && facts.recoveryCodes === 0
      ? await issuingRecoveryCodes(platform, tx, input.personId, input.at)
      : undefined;
  return ok({ passkeyId: input.passkeyId, stamped, issued });
};

/**
 * Called once the library has verified and kept a new passkey: records it, counts the adding as
 * the session's confirmation, and issues recovery codes to a person who must hold a factor and
 * holds none.
 */
export const recordPasskeyAdded = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: SetUpInput & { readonly passkeyId: string },
): Promise<Result<PasskeyAdded, RecordPasskeyAddedRefusal | Error>> => {
  const ids = idsOf(input);
  if (ids === undefined) return err("malformed");

  const added = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => recordingAdded(platform, tx, { ...input, ...ids })),
  );
  if (!added.ok) return err(added.error);
  return added.value;
};

/** What a page sends to rename one of the person's own passkeys. */
export const renamePasskeyInput = z.object({ passkeyId: z.string(), name: z.string() });

export type RenamePasskeyRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "no-passkey" | "passkey-name-empty" | "passkey-name-too-long"
>;

type PasskeyRenamed = { readonly passkeyId: string; readonly name: string };

/** The person is the one caller: a transport hands the id of the session's own person. */
export const renamePasskey = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string } & z.output<typeof renamePasskeyInput>,
): Promise<Result<PasskeyRenamed, RenamePasskeyRefusal | Error>> => {
  const ids = idsOf(input);
  if (ids === undefined) return err("malformed");
  const name = applyPasskeyNameRule(input.name);
  if (!name.ok) return err(name.error);

  const renamed = await attempt(() =>
    withIdentityWrite(
      platform,
      door,
      async (tx): Promise<Result<PasskeyRenamed, "person-gone" | "no-passkey">> => {
        if (!(await holdThePerson(tx, ids.personId))) return err("person-gone");
        const written = await tx.query(
          "UPDATE passkey SET name = $3 WHERE id = $1 AND user_id = $2",
          [ids.passkeyId, ids.personId, name.value],
        );
        if (written.rowCount !== 1) return err("no-passkey");
        await recording(platform, tx, ids, PASSKEY_ACTS.passkeyRenamed);
        return ok({ passkeyId: ids.passkeyId, name: name.value });
      },
    ),
  );
  if (!renamed.ok) return err(renamed.error);
  return renamed.value;
};

/** What a page sends to remove one of the person's own passkeys. */
export const removePasskeyInput = z.object({ passkeyId: z.string() });

export type RemovePasskeyRefusal = WorkspaceRefusal<
  "malformed" | "person-gone" | "no-passkey" | "last-second-factor"
>;

type Removal = Result<{ readonly passkeyId: string }, RemovePasskeyRefusal>;

/** An authenticator still waiting on its code holds nothing, so it keeps no passkey standing. */
const removing = async (platform: PlatformPrincipal, tx: Tx, ids: Ids): Promise<Removal> => {
  if (!(await holdThePerson(tx, ids.personId))) return err("person-gone");
  if (!(await holds(tx, ids))) return err("no-passkey");
  const facts = await factsOf(tx, ids.personId);
  if (facts?.mustHoldOne === true && facts.passkeys === 1 && facts.authenticator !== "set-up") {
    return err("last-second-factor");
  }
  await tx.query("DELETE FROM passkey WHERE id = $1", [ids.passkeyId]);
  await recording(platform, tx, ids, PASSKEY_ACTS.passkeyRemoved);
  return ok({ passkeyId: ids.passkeyId });
};

/**
 * The person is the one caller. An Admin in any workspace, or the operator, keeps their last
 * second factor: the check runs under the person's lock, so two removals cannot each leave one.
 */
export const removePasskey = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string } & z.output<typeof removePasskeyInput>,
): Promise<Result<{ readonly passkeyId: string }, RemovePasskeyRefusal | Error>> => {
  const ids = idsOf(input);
  if (ids === undefined) return err("malformed");

  const removed = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => removing(platform, tx, ids)),
  );
  if (!removed.ok) return err(removed.error);
  return removed.value;
};

const USING = `
  INSERT INTO passkey_last_use (passkey_id, at)
  SELECT id, $2 FROM passkey WHERE credential_id = $1
  ON CONFLICT (passkey_id) DO UPDATE SET at = EXCLUDED.at`;

/**
 * Keyed by the credential a sign-in presents, the one id the library's verify hands on. A use is
 * no change to the factor, so nothing is recorded on the log.
 */
export const recordPasskeyUse = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly credentialId: string; readonly at: Date },
): Promise<Result<{ readonly recorded: boolean }, Error>> => {
  const used = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => tx.query(USING, [input.credentialId, input.at])),
  );
  if (!used.ok) return err(used.error);
  return ok({ recorded: used.value.rowCount === 1 });
};

const DISMISSING = `
  UPDATE "user" SET passkey_offer_dismissed_at = COALESCE(passkey_offer_dismissed_at, $2)
   WHERE id = $1 AND ${notErasedAt("email")}`;

/** A preference, not a change to any factor, so nothing is recorded on the log. */
export const dismissPasskeyOffer = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string; readonly now: Date },
): Promise<Result<undefined, WorkspaceRefusal<"malformed" | "person-gone"> | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const dismissed = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => tx.query(DISMISSING, [personId.data, input.now])),
  );
  if (!dismissed.ok) return err(dismissed.error);
  return dismissed.value.rowCount === 1 ? ok(undefined) : err("person-gone");
};
