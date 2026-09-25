import type { TestApp } from "./harness.ts";
import { sessionPointedAt } from "./provoke.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

type WebApi = Awaited<ReturnType<typeof webSignedIn>>["api"];

export const ROLE_FORBIDS_ANSWERED = {
  data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
} as const;

export const NOT_A_MEMBER_ANSWERED = {
  data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
} as const;

/** For a refusal of what was asked rather than of who asked: the workspace's own Admin calls. */
export const refusalToTheAdmin = async (
  app: TestApp,
  call: (api: WebApi) => Promise<unknown>,
): Promise<unknown> => {
  const workspace = await app.provision();
  const { api } = await webSignedIn(app, workspace.admin.email);
  return refusalOfCall(call(api));
};

/** Every People procedure is an Admin's, so each is called by a member who is not one. */
export const refusalToAMemberAt = async (
  app: TestApp,
  role: "Editor" | "Viewer",
  call: (api: WebApi) => Promise<unknown>,
): Promise<unknown> => {
  const workspace = await app.provision();
  const person = await app.person();
  await app.addMember(workspace.workspaceId, person.id, role);
  const { api } = await webSignedIn(app, person.email);
  return refusalOfCall(call(api));
};

/** Signed in to a workspace of their own, with a session that names `workspaceId` instead. */
export const anAdminOfElsewherePointedAt = async (
  app: TestApp,
  workspaceId: string,
): Promise<WebApi> => {
  const elsewhere = await app.provision();
  const { api } = await webSignedIn(app, elsewhere.admin.email);
  await sessionPointedAt(app, elsewhere.admin.id, workspaceId);
  return api;
};

/** An Admin of another workspace, their session pointed here: each People procedure refuses them. */
export const refusalToAnotherWorkspacesAdmin = async (
  app: TestApp,
  call: (api: WebApi) => Promise<unknown>,
): Promise<unknown> => {
  const workspace = await app.provision();
  return refusalOfCall(call(await anAdminOfElsewherePointedAt(app, workspace.workspaceId)));
};
