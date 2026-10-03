import { expect } from "vitest";
import { z } from "zod";

import { restoreSignIn, SIGN_IN_CODE_PREFIX } from "@better-answers/core/workspaces";
import { testData } from "@better-answers/schema/testing";
import { authenticatorCodeAt, keyIn } from "@better-answers/schema/testing/authenticator-code";

import { IDENTITY_PRINCIPAL } from "../src/identity-principal.ts";
import { authOver } from "./auth-instance.ts";
import { signIn, signInByEmailOnly } from "./flow.ts";
import type { TestApp, TestClient } from "./harness.ts";
import { aPasskeyDevice } from "./passkey-device.ts";

/** Past the second factor where one is required, by the harness's own writes. */
export const signedInClient = async (app: TestApp, email: string): Promise<TestClient> => {
  const client = app.client();
  await signIn(app, client, email);
  return client;
};

/** By the emailed code alone: a person who must hold a second factor is left pending. */
export const signedInByEmailOnly = async (app: TestApp, email: string): Promise<TestClient> => {
  const client = app.client();
  await signInByEmailOnly(app, client, email);
  return client;
};

/** A person in no workspace, so nobody requires a factor of them, signed in. */
export const aPersonSignedIn = async (app: TestApp) => {
  const person = await app.person();
  return { person, client: await signedInClient(app, person.email) };
};

/** A new workspace's Admin, who must hold a factor and holds none, signed in and pending setup. */
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

/** An authenticator set up for `email`, then a session signed in by email and not yet confirmed. */
const heldThenSignedIn = async (app: TestApp, email: string) => {
  const key = await setUpAnAuthenticator(app, await signedInByEmailOnly(app, email));
  return { key, client: await signedInByEmailOnly(app, email) };
};

/** A person in no workspace holding an authenticator whose `key` makes its codes. */
export const aPersonWithAnAuthenticator = async (app: TestApp) => {
  const person = await app.person();
  return { person, ...(await heldThenSignedIn(app, person.email)) };
};

/** A new workspace's Admin holding an authenticator whose `key` makes its codes. */
export const anAdminWithAnAuthenticator = async (app: TestApp) => {
  const { admin } = await app.provision();
  return { admin, ...(await heldThenSignedIn(app, admin.email)) };
};

const started = z.object({ setupAddress: z.string().startsWith("otpauth://totp/") });

export const codeNow = (setupAddress: string): string =>
  authenticatorCodeAt(keyIn(setupAddress), new Date());

export const aWrongCode = (right: string): string => (right === "000000" ? "111111" : "000000");

/** Starts a setup through the api's own route; answers the address its QR code carries. */
export const startOn = async (client: TestClient): Promise<string> => {
  const answered = await client.json("/authenticator/start", {});
  expect(answered.status, "the setup did not start").toBe(200);
  return started.parse(await answered.json()).setupAddress;
};

/** A setup started and finished with the code its key shows now; `client` stays signed in. */
export const setUpOn = async (client: TestClient) => {
  const setupAddress = await startOn(client);
  return {
    setupAddress,
    answered: await client.json("/authenticator/finish", { code: codeNow(setupAddress) }),
  };
};

/**
 * The ops command's own restore under its own principal, sending no notice; answers the code.
 * @throws when no person holds `email`.
 */
export const restoredByTheOperator = async (app: TestApp, email: string): Promise<string> => {
  const restored = await restoreSignIn(IDENTITY_PRINCIPAL, app.doors.postgres, {
    email,
    now: new Date(),
  });
  if (!restored.ok) throw new Error(`the restore was refused: ${String(restored.error)}`);
  return restored.value.code;
};

/** A passkey added through the api's two steps, from a device of its own. */
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

/** A passkey, an authenticator and its ten codes, set up through the api; then an unconfirmed email session. */
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

/** Runs `work` over one superuser connection, past row-level security. */
export const seededIn = async <T>(app: TestApp, work: (seed: TestData) => Promise<T>) => {
  const client = await app.database.superuser.connect();
  try {
    return await work(testData(client));
  } finally {
    client.release();
  }
};

/** The confirmations `sources.publish` asks for, each given. */
export const THE_THREE_CONFIRMATIONS = {
  lawfulBasisRecorded: true,
  privacyInformationUpdated: true,
  dpiaReferenced: true,
} as const;

/** @throws when no constraint has the name. */
export const constraintDefinition = async (app: TestApp, name: string): Promise<string> => {
  const found = await app.database.superuser.query<{ definition: string }>(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1",
    [name],
  );
  const definition = found.rows[0]?.definition;
  if (definition === undefined) throw new Error(`no constraint named ${name}`);
  return definition;
};

/** Signed in as a Viewer of two new workspaces, with neither chosen as the active one. */
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

/**
 * The row is written and locked with its commit still to come: the moment a held membership read
 * must wait out.
 */
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

export const someoneWaitsOnALock = async (app: TestApp): Promise<boolean> => {
  const found = await app.database.superuser.query<{ waiting: number }>(
    `SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`,
  );
  return (found.rows[0]?.waiting ?? 0) > 0;
};

/** Moves every session `userId` holds to a sign-in 61 minutes ago, behind the api's back. */
export const sessionsSignedInOverAnHourAgo = async (
  app: TestApp,
  userId: string,
): Promise<void> => {
  await app.database.superuser.query(
    "UPDATE session SET created_at = now() - interval '61 minutes' WHERE user_id = $1",
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

/** Points every session `userId` holds at the workspace, behind the api's back. */
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

/**
 * Every write an act makes lands, and its commit is what fails, so anything sent before the
 * commit would already have gone.
 */
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
