import type { Api } from "../stubbed-api.ts";
import { ADA, adaAnAdmin, aRefusalAnswer, read } from "../two-workspaces.ts";

const NEEDS_A_PICK = aRefusalAnswer("no-active-workspace", "unauthenticated", 401);

export const signedInAs = (name: string) => ({
  session: { id: "s" },
  user: { id: ADA.personId, name, email: ADA.address },
});

export const aPersonNamedWithNoWorkspace = (name: string): Api => {
  const api = adaAnAdmin();
  api.set("/get-session", () => signedInAs(name));
  api.set("session.member", () => NEEDS_A_PICK);
  api.set("person.workspaces", () => read([]));
  api.set("person.invitations", () => read([]));
  return api;
};
