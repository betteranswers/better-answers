import type { TestApp } from "./harness.ts";
import { sessionPointedAt, signedInClient } from "./provoke.ts";
import { refusalOfCall, webClientOf, webSignedIn } from "./web-client.ts";

type WebApi = Awaited<ReturnType<typeof webSignedIn>>["api"];

export const ROLE_FORBIDS_ANSWERED = {
  data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
} as const;

export const NOT_A_MEMBER_ANSWERED = {
  data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
} as const;

export const refusalToTheAdmin = async (
  app: TestApp,
  call: (api: WebApi) => Promise<unknown>,
): Promise<unknown> => {
  const workspace = await app.provision();
  const { api } = await webSignedIn(app, workspace.admin.email);
  return refusalOfCall(call(api));
};

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

export const anAdminOfElsewherePointedAt = async (
  app: TestApp,
  workspaceId: string,
): Promise<WebApi> => {
  const elsewhere = await app.provision();
  const client = await signedInClient(app, elsewhere.admin.email);
  await sessionPointedAt(app, elsewhere.admin.id, workspaceId);
  return webClientOf(client, workspaceId).api;
};

export const refusalToAnotherWorkspacesAdmin = async (
  app: TestApp,
  call: (api: WebApi) => Promise<unknown>,
): Promise<unknown> => {
  const workspace = await app.provision();
  return refusalOfCall(call(await anAdminOfElsewherePointedAt(app, workspace.workspaceId)));
};
