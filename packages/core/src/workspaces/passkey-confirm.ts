import { boundarySchemas } from "@better-answers/schema";

import { attempt, err, ok, type PlatformPrincipal, type Result, ulid } from "../kernel/index.ts";
import { type PostgresDoor, withIdentityRead, withIdentityWrite } from "../store/postgres/index.ts";
import { PASSKEY_CHALLENGE_PREFIX } from "./sign-in-and-consent.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** How long a passkey confirm's challenge waits for the device's answer. */
const CHALLENGE_KEPT_FOR_MS = 5 * 60_000;

const challengeUnder = (sessionId: string): string => `${PASSKEY_CHALLENGE_PREFIX}${sessionId}`;

/** Written only under a session the person holds, so no caller keeps one for a stranger's. */
const KEEPING = `
  INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
  SELECT $1, $2, $3, $4, $5, $5 FROM session WHERE id = $6 AND user_id = $7`;

type ChallengeInput = {
  readonly personId: string;
  readonly sessionId: string;
  readonly challenge: string;
  readonly now: Date;
};

type KeepPasskeyChallengeRefusal = WorkspaceRefusal<"malformed" | "session-gone">;

/**
 * Keeps the challenge the api handed a session's passkey confirm, for five minutes. A session
 * keeps one at a time: a later ask replaces the earlier.
 */
export const keepPasskeyChallenge = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ChallengeInput,
): Promise<Result<undefined, KeepPasskeyChallengeRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const identifier = challengeUnder(input.sessionId);
  const kept = await attempt(() =>
    withIdentityWrite(platform, door, async (tx) => {
      await tx.query("DELETE FROM verification WHERE identifier = $1", [identifier]);
      return tx.query(KEEPING, [
        ulid(),
        identifier,
        input.challenge,
        new Date(input.now.getTime() + CHALLENGE_KEPT_FOR_MS),
        input.now,
        input.sessionId,
        personId.data,
      ]);
    }),
  );
  if (!kept.ok) return err(kept.error);
  return kept.value.rowCount === 1 ? ok(undefined) : err("session-gone");
};

/** Spent by its first answer, live or not, so one challenge never verifies twice. */
const TAKING = `
  DELETE FROM verification WHERE identifier = $1
  RETURNING value, expires_at > $2 AS live`;

/** The challenge this session was handed, while it lasts; taking it spends it. */
export const takePasskeyChallenge = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly sessionId: string; readonly now: Date },
): Promise<Result<string | undefined, Error>> => {
  const taken = await attempt(() =>
    withIdentityWrite(platform, door, (tx) =>
      tx.query<{ value: string; live: boolean }>(TAKING, [
        challengeUnder(input.sessionId),
        input.now,
      ]),
    ),
  );
  if (!taken.ok) return err(taken.error);
  const row = taken.value.rows[0];
  return ok(row?.live === true ? row.value : undefined);
};

type PasskeyCredential = {
  readonly credentialId: string;

  /** As the library keeps it: the COSE key, base64. */
  readonly publicKey: string;
  readonly counter: number;

  /** Comma-separated, as the library keeps them. */
  readonly transports: string | null;
};

/** The counter is a bigint column, which the driver would hand over as text. */
const CREDENTIALS = `
  SELECT credential_id AS "credentialId", public_key AS "publicKey",
         counter::double precision AS counter, transports
    FROM passkey WHERE user_id = $1
   ORDER BY created_at, id`;

/** The person's own passkeys, as a verifier needs them; a public key is no secret. */
export const readPasskeyCredentials = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string },
): Promise<Result<readonly PasskeyCredential[], WorkspaceRefusal<"malformed"> | Error>> => {
  const holder = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!holder.success) return err("malformed");

  const credentials = await attempt(async () => {
    const found = await withIdentityRead(platform, door, (tx) =>
      tx.query<PasskeyCredential>(CREDENTIALS, [holder.data]),
    );
    return found.rows;
  });
  return credentials.ok ? ok(credentials.value) : err(credentials.error);
};
