import { signIn } from "./flow.ts";
import { APP_HOSTNAME, type TestApp, type TestClient } from "./harness.ts";

export const signedInClient = async (app: TestApp, email: string): Promise<TestClient> => {
  const client = app.client(undefined, APP_HOSTNAME);
  await signIn(app, client, email);
  return client;
};

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
