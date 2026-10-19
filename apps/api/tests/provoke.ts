import { expect } from "vitest";
import { z } from "zod";

import { sessionFor } from "@better-answers/core/testing/identity-rows";
import { holdingTable, isBlockedOnTable, until } from "@better-answers/core/testing/postgres";
import { restoreSignIn, SIGN_IN_CODE_PREFIX } from "@better-answers/core/workspaces";
import { testData } from "@better-answers/schema/testing";
import { authenticatorCodeAt, keyIn } from "@better-answers/schema/testing/authenticator-code";

import { SESSION_LIFETIME_SECONDS } from "../src/auth/constants.ts";
import { IDENTITY_PRINCIPAL } from "../src/identity-principal.ts";
import { authOver } from "./auth-instance.ts";
import { signIn, signInByEmailOnly } from "./flow.ts";
import type { TestApp, TestClient } from "./harness.ts";
import { aPasskeyDevice } from "./passkey-device.ts";

export const signedInClient = async (app: TestApp, email: string): Promise<TestClient> => {
  const client = app.client();
  await signIn(app, client, email);
  return client;
};

export const signedInByEmailOnly = async (app: TestApp, email: string): Promise<TestClient> => {
  const client = app.client();
  await signInByEmailOnly(app, client, email);
  return client;
};

export const aPersonSignedIn = async (app: TestApp) => {
  const person = await app.person();
  return { person, client: await signedInClient(app, person.email) };
};

export const anAdminSignedIn = async (app: TestApp) => {
  const { admin } = await app.provision();
  return { admin, client: await signedInByEmailOnly(app, admin.email) };
};

/**
 * Through the library's own enable and first verify, as server functions. The verify swaps the
 * session for one nobody holds, which is ended.
 */
export const setUpAnAuthenticator = async (app: TestApp, client: TestClient): Promise<string> => {
  const auth = authOver(app);
  const headers = new Headers({ cookie: client.cookies() });
  const enabled = await auth.api.enableTwoFactor({ headers, body: { method: "totp" } });
  const key = keyIn(z.object({ totpURI: z.string() }).parse(enabled).totpURI);
  const verified = await auth.api.verifyTOTP({
    headers,
    body: { code: authenticatorCodeAt(key, new Date()) },
    returnHeaders: true,
  });
  const swappedIn = verified.headers.getSetCookie().map((line) => line.split(";")[0] ?? "");
  await auth.api.signOut({ headers: new Headers({ cookie: swappedIn.join("; ") }) });
  return key;
};

const heldThenSignedIn = async (app: TestApp, email: string) => {
  const key = await setUpAnAuthenticator(app, await signedInByEmailOnly(app, email));
  return { key, client: await signedInByEmailOnly(app, email) };
};

export const aPersonWithAnAuthenticator = async (app: TestApp) => {
  const person = await app.person();
  return { person, ...(await heldThenSignedIn(app, person.email)) };
};

export const anAdminWithAnAuthenticator = async (app: TestApp) => {
  const { admin } = await app.provision();
  return { admin, ...(await heldThenSignedIn(app, admin.email)) };
};

const started = z.object({ setupAddress: z.string().startsWith("otpauth://totp/") });

export const codeNow = (setupAddress: string): string =>
  authenticatorCodeAt(keyIn(setupAddress), new Date());

export const aWrongCode = (right: string): string => (right === "000000" ? "111111" : "000000");

export const startOn = async (client: TestClient): Promise<string> => {
  const answered = await client.json("/authenticator/start", {});
  expect(answered.status, "the setup did not start").toBe(200);
  return started.parse(await answered.json()).setupAddress;
};

export const setUpOn = async (client: TestClient) => {
  const setupAddress = await startOn(client);
  return {
    setupAddress,
    answered: await client.json("/authenticator/finish", { code: codeNow(setupAddress) }),
  };
};

export const restoredByTheOperator = async (app: TestApp, email: string): Promise<string> => {
  const restored = await restoreSignIn(IDENTITY_PRINCIPAL, app.doors.postgres, {
    email,
    now: new Date(),
  });
  if (!restored.ok) throw new Error(`the restore was refused: ${String(restored.error)}`);
  return restored.value.code;
};

export const passkeyAddedOn = async (client: TestClient) => {
  const device = aPasskeyDevice(client.origin);
  const options = await client.json("/passkeys/add-options", { name: "Phone" });
  expect(options.status, "the add was not asked").toBe(200);
  const answered = await client.json("/passkeys/add", {
    name: "Phone",
    response: device.create(await options.json()),
  });
  return { device, answered };
};

const codesIssued = z.object({ recoveryCodes: z.array(z.string()) });

export const aPersonHoldingEverything = async (app: TestApp) => {
  const { person, client: setUpIn } = await aPersonSignedIn(app);
  const { device } = await passkeyAddedOn(setUpIn);
  const { setupAddress, answered } = await setUpOn(setUpIn);
  const { recoveryCodes } = codesIssued.parse(await answered.json());
  return {
    person,
    device,
    key: keyIn(setupAddress),
    recoveryCodes,
    client: await signedInByEmailOnly(app, person.email),
  };
};

export const displayNameHeldBy = async (
  app: TestApp,
  personId: string,
): Promise<string | undefined> => {
  const found = await app.database.superuser.query<{ name: string }>(
    'SELECT name FROM "user" WHERE id = $1',
    [personId],
  );
  return found.rows[0]?.name;
};

type TestData = ReturnType<typeof testData>;

export const seededIn = async <T>(app: TestApp, work: (seed: TestData) => Promise<T>) => {
  const client = await app.database.superuser.connect();
  try {
    return await work(testData(client));
  } finally {
    client.release();
  }
};

export const THE_THREE_CONFIRMATIONS = {
  lawfulBasisRecorded: true,
  privacyInformationUpdated: true,
  dpiaReferenced: true,
} as const;

export const constraintDefinition = async (app: TestApp, name: string): Promise<string> => {
  const found = await app.database.superuser.query<{ definition: string }>(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1",
    [name],
  );
  const definition = found.rows[0]?.definition;
  if (definition === undefined) throw new Error(`no constraint named ${name}`);
  return definition;
};

export const memberOfTwoWorkspaces = async (app: TestApp): Promise<TestClient> => {
  const first = await app.provision();
  const second = await app.provision();
  const person = await app.person();
  await app.addMember(first.workspaceId, person.id, "Viewer");
  await app.addMember(second.workspaceId, person.id, "Viewer");
  return signedInClient(app, person.email);
};

export type HeldRevocation = {
  land(): Promise<void>;
  abandon(): Promise<void>;
};

export const revocationHeldOpen = async (app: TestApp, userId: string): Promise<HeldRevocation> => {
  const revoking = await app.database.superuser.connect();
  await revoking.query("BEGIN");
  await revoking.query('UPDATE "user" SET credentials_revoked_at = $2 WHERE id = $1', [
    userId,
    new Date(Date.now() + 60_000),
  ]);
  const state = { ended: false };
  const end = async (how: "COMMIT" | "ROLLBACK"): Promise<void> => {
    if (state.ended) return;
    state.ended = true;
    try {
      await revoking.query(how);
    } finally {
      revoking.release();
    }
  };
  return { land: () => end("COMMIT"), abandon: () => end("ROLLBACK") };
};

export const aSeededSessionFor = async (
  app: TestApp,
  personId: string,
  agent: { readonly userAgent?: string | null },
  expiresAt?: Date,
): Promise<string> => {
  const now = new Date();
  return sessionFor(app.database.superuser, personId, {
    createdAt: now,
    lastUsedAt: now,
    expiresAt: expiresAt ?? new Date(now.getTime() + SESSION_LIFETIME_SECONDS * 1000),
    ipAddress: "203.0.113.7",
    ...(agent.userAgent === undefined || agent.userAgent === null
      ? {}
      : { userAgent: agent.userAgent }),
  });
};

export const waitingOnALock = async (app: TestApp): Promise<number> => {
  const found = await app.database.superuser.query<{ waiting: number }>(
    `SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`,
  );
  return found.rows[0]?.waiting ?? 0;
};

export const someoneWaitsOnALock = async (app: TestApp): Promise<boolean> =>
  (await waitingOnALock(app)) > 0;

export const sessionsAgedUnderTheApi = async (app: TestApp, userId: string): Promise<void> => {
  await app.database.superuser.query(
    "UPDATE session SET created_at = now() - interval '61 minutes' WHERE user_id = $1",
    [userId],
  );
};

export const confirmationsAgedOverAnHourAgo = async (
  app: TestApp,
  userId: string,
): Promise<void> => {
  await app.database.superuser.query(
    "UPDATE session SET second_factor_confirmed_at = now() - interval '61 minutes' WHERE user_id = $1",
    [userId],
  );
};

export const pendingSessionsPastTheirHour = async (app: TestApp, userId: string): Promise<void> => {
  await app.database.superuser.query(
    "UPDATE session SET pending_since = now() - interval '61 minutes' WHERE user_id = $1",
    [userId],
  );
};

/** The library judges expiry on the api's clock, so the past is this process's, not the database's. */
export const codeSentPastItsExpiry = async (app: TestApp, email: string): Promise<void> => {
  const aged = await app.database.superuser.query(
    "UPDATE verification SET expires_at = $2 WHERE identifier = $1",
    [`${SIGN_IN_CODE_PREFIX}${email.toLowerCase()}`, new Date(Date.now() - 60_000)],
  );
  if (aged.rowCount === 0) throw new Error(`no code was sent to ${email}`);
};

export const sessionPointedAt = async (
  app: TestApp,
  userId: string,
  workspaceId: string,
): Promise<void> => {
  await app.database.superuser.query(
    "UPDATE session SET active_workspace_id = $2 WHERE user_id = $1",
    [userId, workspaceId],
  );
};

export const whileCommitsAreRefused = async <T>(
  app: TestApp,
  table: string,
  work: () => Promise<T>,
): Promise<T> => {
  const store = app.database.superuser;
  await store.query(
    `CREATE FUNCTION test_refuse_commit() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'the store refused the commit'; END $$`,
  );
  await store.query(
    `CREATE CONSTRAINT TRIGGER test_refuse_commit AFTER INSERT OR UPDATE ON "${table}"
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_refuse_commit()`,
  );
  try {
    return await work();
  } finally {
    await store.query(`DROP TRIGGER test_refuse_commit ON "${table}"`);
    await store.query("DROP FUNCTION test_refuse_commit()");
  }
};

export const whileTheApiLacks = async <T>(
  app: TestApp,
  privilege: "SELECT" | "UPDATE" | "DELETE",
  table: string,
  work: () => Promise<T>,
): Promise<T> => {
  const store = app.database.superuser;
  await store.query(`REVOKE ${privilege} ON "${table}" FROM app_rt`);
  try {
    return await work();
  } finally {
    await store.query(`GRANT ${privilege} ON "${table}" TO app_rt`);
  }
};

export const changedWhileItWaitsOn = async <T>(
  app: TestApp,
  table: string,
  work: () => Promise<T>,
  change: () => Promise<unknown>,
): Promise<T> => {
  const store = app.database.superuser;
  // Wrapped, or the lock would be held until the work it blocks had ended.
  const held = await holdingTable(store, table, async () => {
    const working = work();
    await until(() => isBlockedOnTable(store, table));
    await change();
    return { working };
  });
  return held.working;
};

/**
 * The insert lands no row and raises nothing, so Postgres leaves the transaction open: only the
 * transport's rollback can undo the write before it.
 */
export const whileAuditRowsVanish = async <T>(app: TestApp, work: () => Promise<T>): Promise<T> => {
  const { superuser } = app.database;
  await superuser.query(
    `CREATE FUNCTION test_audit_row_vanishes() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RETURN NULL; END $$`,
  );
  await superuser.query(
    `CREATE TRIGGER test_audit_row_vanishes BEFORE INSERT ON audit_event
     FOR EACH ROW EXECUTE FUNCTION test_audit_row_vanishes()`,
  );
  try {
    return await work();
  } finally {
    await superuser.query("DROP TRIGGER test_audit_row_vanishes ON audit_event");
    await superuser.query("DROP FUNCTION test_audit_row_vanishes()");
  }
};

const FAILED = z.object({
  message: z.string(),
  data: z.object({ httpStatus: z.number(), refusal: z.unknown().optional() }),
});

export const failureOf = (failed: unknown) => {
  const { message, data } = FAILED.parse(failed);
  return { message, httpStatus: data.httpStatus, refusal: data.refusal };
};
