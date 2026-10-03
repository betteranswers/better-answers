import { z } from "zod";

import { acknowledgeRecoveryCodes, replaceRecoveryCodes } from "@better-answers/core/workspaces";
import { testData } from "@better-answers/schema/testing";
import { keyIn } from "@better-answers/schema/testing/authenticator-code";

import { mintAuthenticatorKey } from "../src/auth/authenticator-key.ts";
import { IDENTITY_PRINCIPAL } from "../src/identity-principal.ts";
import { authOver } from "./auth-instance.ts";
import type { TestApp, TestClient } from "./harness.ts";

const keys = new WeakMap<TestApp, Map<string, string>>();

const keysOf = (app: TestApp): Map<string, string> => {
  const held = keys.get(app) ?? new Map<string, string>();
  keys.set(app, held);
  return held;
};

/** Sealed as the plugin seals one, so its verify accepts the key's codes; no email, no notice. */
export const holdAnAuthenticator = async (app: TestApp, personId: string): Promise<string> => {
  const { sealed, setupAddress } = await mintAuthenticatorKey(authOver(app), personId);
  const client = await app.database.superuser.connect();
  try {
    await testData(client).authenticator({ userId: personId, secret: sealed });
  } finally {
    client.release();
  }
  const key = keyIn(setupAddress);
  keysOf(app).set(personId, key);
  return key;
};

/** As a first setup leaves a person: ten codes, ticked as saved. One already holding a set keeps it. */
export const savedRecoveryCodes = async (
  app: TestApp,
  personId: string,
): Promise<readonly string[]> => {
  const door = app.doors.postgres;
  const made = await replaceRecoveryCodes(IDENTITY_PRINCIPAL, door, {
    personId,
    replacing: false,
    now: new Date(),
  });
  if (!made.ok && made.error === "recovery-codes-held") return [];
  if (!made.ok) throw new Error(`no recovery codes were made: ${String(made.error)}`);
  const { madeAt, recoveryCodes } = made.value;
  const saved = await acknowledgeRecoveryCodes(IDENTITY_PRINCIPAL, door, { personId, madeAt });
  if (!saved.ok) throw new Error(`the recovery codes were not saved: ${String(saved.error)}`);
  return recoveryCodes;
};

/** The key of an authenticator `holdAnAuthenticator` gave the person, if it gave one. */
export const authenticatorKeyOf = (app: TestApp, personId: string): string | undefined =>
  keysOf(app).get(personId);

const sessionRead = z.object({
  session: z.object({ id: z.string() }),
  user: z.object({ id: z.string() }),
});

const STANDING = `
  SELECT u.operator OR EXISTS (SELECT 1 FROM member m WHERE m.user_id = u.id AND m.role = 'Admin')
           AS required,
         EXISTS (SELECT 1 FROM passkey p WHERE p.user_id = u.id)
           OR EXISTS (SELECT 1 FROM authenticator a WHERE a.user_id = u.id AND a.verified) AS holds
    FROM "user" u WHERE u.id = $1`;

/** A person who must hold a factor is given one if none, and the session stamped as a confirm stamps it. */
export const confirmedByTheHarness = async (app: TestApp, client: TestClient): Promise<void> => {
  const read = sessionRead.parse(await (await client.fetch("/get-session")).json());
  const standing = await app.database.superuser.query<{ required: boolean; holds: boolean }>(
    STANDING,
    [read.user.id],
  );
  const row = standing.rows[0];
  if (row === undefined || !row.required) return;
  if (!row.holds) await holdAnAuthenticator(app, read.user.id);
  await app.database.superuser.query(
    "UPDATE session SET second_factor_confirmed_at = now(), pending_since = NULL WHERE id = $1",
    [read.session.id],
  );
};
