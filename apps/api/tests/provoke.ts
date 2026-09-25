import { testData } from "@better-answers/schema/testing";

import { signIn } from "./flow.ts";
import { APP_HOSTNAME, type TestApp, type TestClient } from "./harness.ts";

export const signedInClient = async (app: TestApp, email: string): Promise<TestClient> => {
  const client = app.client(undefined, APP_HOSTNAME);
  await signIn(app, client, email);
  return client;
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
